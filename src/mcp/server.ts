import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { ServerNotification } from '@modelcontextprotocol/sdk/types.js';
import { execFile } from 'child_process';
import { appendFileSync, existsSync, mkdirSync } from 'fs';
import { homedir, platform } from 'os';
import { join } from 'path';
import { z } from 'zod';
import { loadConfig, saveConfig } from '../shared/config.js';
import { EntendiApiClient } from './api-client.js';

const MCP_LOG_DIR = join(homedir(), '.entendi');
const MCP_LOG_FILE = join(MCP_LOG_DIR, 'debug.log');
let mcpLogReady = false;

function mcpLog(message: string, data?: unknown): void {
  if (!mcpLogReady) {
    try { mkdirSync(MCP_LOG_DIR, { recursive: true }); } catch {}
    mcpLogReady = true;
  }
  const ts = new Date().toISOString();
  let dataStr = '';
  if (data !== undefined) {
    if (data instanceof Error) {
      dataStr = ` ${JSON.stringify({ error: data.message, stack: data.stack })}`;
    } else if (typeof data === 'object' && data !== null && 'error' in data) {
      const d = data as Record<string, unknown>;
      const err = d.error;
      if (err instanceof Error) {
        dataStr = ` ${JSON.stringify({ ...d, error: err.message, stack: err.stack })}`;
      } else {
        dataStr = ` ${JSON.stringify(data)}`;
      }
    } else {
      dataStr = ` ${JSON.stringify(data)}`;
    }
  }
  try {
    appendFileSync(MCP_LOG_FILE, `[${ts}] [mcp] ${message}${dataStr}\n`);
  } catch {}
}

export interface EntendiServerOptions {
  /** API base URL (e.g. http://localhost:3456 or https://api.entendi.dev) */
  apiUrl: string;
  /** API key for authentication. When omitted, only entendi_login is available. */
  apiKey?: string;
}

export interface EntendiServer {
  close(): Promise<void>;
  getRegisteredTools(): Array<{ name: string }>;
  getApiClient(): EntendiApiClient;
  /** The underlying McpServer instance, for transport connection */
  getMcpServer(): McpServer;
}

export function wrapToolError(err: unknown): string {
  const msg = String(err instanceof Error ? err.message : err);

  if (msg.includes('Circuit breaker OPEN')) {
    return 'Entendi is temporarily unavailable. Your work continues normally — concept tracking will resume automatically.';
  }
  if (msg.includes('ECONNREFUSED') || msg.includes('ETIMEDOUT') || msg.includes('fetch failed') || msg.includes('AbortError') || msg.includes('operation was aborted')) {
    return "Can't reach the Entendi API right now. This doesn't affect your work.";
  }
  if (/\b401\b/.test(msg) || /\b403\b/.test(msg) || msg.includes('Unauthorized') || msg.includes('Forbidden')) {
    return 'Your Entendi session has expired. Run `entendi_login` to re-authenticate.';
  }
  if (/\b429\b/.test(msg) || msg.includes('Too Many Requests') || msg.includes('Rate limit')) {
    return 'Rate limit reached. Try again later.';
  }
  if (/\b5\d{2}\b/.test(msg) || msg.includes('Internal Server Error') || msg.includes('Bad Gateway') || msg.includes('Service Unavailable')) {
    return 'Entendi server error. Your work continues normally.';
  }
  if (msg.includes('token') && (msg.includes('expired') || msg.includes('invalid') || msg.includes('Expired'))) {
    return 'This probe has expired. A new one will be issued next time.';
  }

  return 'Entendi encountered an unexpected error. Your work continues normally.';
}

export function createEntendiServer(options: EntendiServerOptions): EntendiServer {
  const mcpServer = new McpServer({
    name: 'entendi',
    version: '0.2.0',
  });

  const api = new EntendiApiClient({
    apiUrl: options.apiUrl,
    apiKey: options.apiKey ?? '',
  });

  const authenticated = !!options.apiKey;
  const registeredTools: Array<{ name: string }> = [];

  // Tools 1-7 require authentication
  if (authenticated) {

  // --- Tool 1: entendi_observe ---
  mcpServer.tool(
    'entendi_observe',
    'Observe concepts detected after a tool use. Determines if a comprehension probe is appropriate.',
    {
      concepts: z.preprocess(
        (v) => (typeof v === 'string' ? JSON.parse(v) : v),
        z.array(z.object({
          id: z.string(),
          source: z.enum(['package', 'ast', 'llm']),
        })),
      ),
      triggerContext: z.string(),
      primaryConceptId: z.preprocess(
        (v) => (v === '' || v === null ? undefined : v),
        z.string().optional(),
      ),
      repoUrl: z.preprocess(
        (v) => (v === '' || v === null ? undefined : v),
        z.string().url().optional(),
      ),
    },
    async (args, extra) => {
      mcpLog('tool:entendi_observe called', args);
      const progressToken = extra._meta?.progressToken;
      try {
        const result = await api.observe({
          concepts: args.concepts,
          triggerContext: args.triggerContext,
          primaryConceptId: args.primaryConceptId,
          repoUrl: args.repoUrl,
        });
        // Emit progress notification if token was provided and multiple concepts were sent
        if (progressToken !== undefined && args.concepts.length > 1) {
          try {
            await extra.sendNotification({
              method: 'notifications/progress',
              params: {
                progressToken,
                progress: args.concepts.length,
                total: args.concepts.length,
                message: `Processed ${args.concepts.length} concepts`,
              },
            } as ServerNotification);
          } catch (notifErr) {
            mcpLog('tool:entendi_observe progress notification failed', { error: String(notifErr) });
          }
        }
        mcpLog('tool:entendi_observe result', result);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      } catch (err) {
        mcpLog('tool:entendi_observe error', { error: err });
        return { content: [{ type: 'text' as const, text: wrapToolError(err) }], isError: true };
      }
    },
  );
  registeredTools.push({ name: 'entendi_observe' });

  // --- Tool 2: entendi_record_evaluation ---
  mcpServer.tool(
    'entendi_record_evaluation',
    'Record the evaluation of a probe or tutor response. Updates the knowledge graph with Bayesian scoring.',
    {
      conceptId: z.string(),
      score: z.coerce.number().int().min(0).max(3),
      confidence: z.coerce.number().min(0).max(1),
      reasoning: z.string(),
      eventType: z.enum(['probe', 'tutor_phase1', 'tutor_phase4']),
      probeToken: z.preprocess(
        (v) => (typeof v === 'string' ? JSON.parse(v) : v),
        z.object({
          tokenId: z.string(),
          userId: z.string(),
          conceptId: z.string(),
          depth: z.coerce.number(),
          evaluationCriteria: z.string(),
          issuedAt: z.string(),
          expiresAt: z.string(),
          signature: z.string(),
        }).optional(),
      ),
      responseText: z.string().optional(),
    },
    async (args) => {
      mcpLog('tool:entendi_record_evaluation called', args);
      try {
        const result = await api.recordEvaluation({
          conceptId: args.conceptId,
          score: args.score as 0 | 1 | 2 | 3,
          confidence: args.confidence,
          reasoning: args.reasoning,
          eventType: args.eventType,
          probeToken: args.probeToken,
          responseText: args.responseText,
        });
        mcpLog('tool:entendi_record_evaluation result', result);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      } catch (err) {
        mcpLog('tool:entendi_record_evaluation error', { error: err });
        return { content: [{ type: 'text' as const, text: wrapToolError(err) }], isError: true };
      }
    },
  );
  registeredTools.push({ name: 'entendi_record_evaluation' });

  // --- Tool 3: entendi_start_tutor ---
  mcpServer.tool(
    'entendi_start_tutor',
    'Start a 4-phase Socratic tutor session for a concept.',
    {
      conceptId: z.string(),
      triggerScore: z.coerce.number().int().min(0).max(1).nullable().optional(),
    },
    async (args) => {
      mcpLog('tool:entendi_start_tutor called', args);
      try {
        const result = await api.startTutor({
          conceptId: args.conceptId,
          triggerScore: args.triggerScore as 0 | 1 | null | undefined,
        });
        mcpLog('tool:entendi_start_tutor result', result);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      } catch (err) {
        mcpLog('tool:entendi_start_tutor error', { error: err });
        return { content: [{ type: 'text' as const, text: wrapToolError(err) }], isError: true };
      }
    },
  );
  registeredTools.push({ name: 'entendi_start_tutor' });

  // --- Tool 4: entendi_advance_tutor ---
  mcpServer.tool(
    'entendi_advance_tutor',
    'Advance a tutor session to the next phase after the user responds.',
    {
      sessionId: z.string(),
      userResponse: z.string(),
      score: z.coerce.number().int().min(0).max(3).optional(),
      confidence: z.coerce.number().min(0).max(1).optional(),
      reasoning: z.string().optional(),
      misconception: z.string().optional(),
    },
    async (args) => {
      mcpLog('tool:entendi_advance_tutor called', args);
      try {
        const result = await api.advanceTutor({
          sessionId: args.sessionId,
          userResponse: args.userResponse,
          score: args.score as 0 | 1 | 2 | 3 | undefined,
          confidence: args.confidence,
          reasoning: args.reasoning,
          misconception: args.misconception,
        });
        mcpLog('tool:entendi_advance_tutor result', result);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      } catch (err) {
        mcpLog('tool:entendi_advance_tutor error', { error: err });
        return { content: [{ type: 'text' as const, text: wrapToolError(err) }], isError: true };
      }
    },
  );
  registeredTools.push({ name: 'entendi_advance_tutor' });

  // --- Tool 5: entendi_dismiss ---
  mcpServer.tool(
    'entendi_dismiss',
    'Dismiss a pending probe or tutor session with a categorized reason. topic_change: no penalty. busy: re-queues probe for next session (auto-scores 0 after 3 deferrals). claimed_expertise: auto-scores 0 immediately.',
    {
      reason: z.enum(['topic_change', 'busy', 'claimed_expertise']).describe('Why the probe is being dismissed'),
      note: z.string().max(500).optional().describe('Optional context about the dismissal'),
    },
    async (args) => {
      mcpLog('tool:entendi_dismiss called', args);
      try {
        const result = await api.dismiss({
          reason: args.reason,
          note: args.note,
        });
        mcpLog('tool:entendi_dismiss result', result);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      } catch (err) {
        mcpLog('tool:entendi_dismiss error', { error: err });
        return { content: [{ type: 'text' as const, text: wrapToolError(err) }], isError: true };
      }
    },
  );
  registeredTools.push({ name: 'entendi_dismiss' });

  // --- Tool 6: entendi_get_status ---
  mcpServer.tool(
    'entendi_get_status',
    'Query mastery state for a specific concept or get an overview of all concepts.',
    {
      conceptId: z.string().optional(),
    },
    async (args) => {
      mcpLog('tool:entendi_get_status called', args);
      try {
        const result = await api.getStatus(args.conceptId);
        mcpLog('tool:entendi_get_status result', result);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      } catch (err) {
        mcpLog('tool:entendi_get_status error', { error: err });
        return { content: [{ type: 'text' as const, text: wrapToolError(err) }], isError: true };
      }
    },
  );
  registeredTools.push({ name: 'entendi_get_status' });

  // --- Tool 7: entendi_get_zpd_frontier ---
  mcpServer.tool(
    'entendi_get_zpd_frontier',
    'Get the Zone of Proximal Development frontier: concepts the user is ready to learn next.',
    {
      limit: z.coerce.number().int().min(1).max(100).optional()
        .describe('Max concepts to return (default: 20)'),
      domain: z.string().optional()
        .describe('Filter by domain (e.g. "frontend", "databases")'),
      includeUnassessed: z.boolean().optional()
        .describe('Include never-assessed concepts (default: false — only in-progress)'),
    },
    async (args) => {
      mcpLog('tool:entendi_get_zpd_frontier called', args);
      try {
        const result = await api.getZpdFrontier(args);
        mcpLog('tool:entendi_get_zpd_frontier result', result);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      } catch (err) {
        mcpLog('tool:entendi_get_zpd_frontier error', { error: err });
        return { content: [{ type: 'text' as const, text: wrapToolError(err) }], isError: true };
      }
    },
  );
  registeredTools.push({ name: 'entendi_get_zpd_frontier' });

  } // end authenticated tools

  // --- Tool 8: entendi_login (always available) ---
  mcpServer.tool(
    'entendi_login',
    'Link this device to your Entendi account. Call without a code to start (opens browser). Call with the code after confirming in the browser to retrieve your API key.',
    {
      code: z.string().optional().describe('Device code from a previous login attempt. Omit to start a new login flow.'),
    },
    async ({ code }: { code?: string }) => {
      mcpLog('tool:entendi_login called', { code: code ?? 'new' });
      try {
        if (!code) {
          // Phase 1: Create device code and open browser
          const { code: newCode, verifyUrl, expiresAt } = await api.createDeviceCode();
          mcpLog('tool:entendi_login device code created', { code: newCode, verifyUrl });

          const os = platform();
          const openCmd = os === 'darwin' ? 'open' : os === 'win32' ? 'cmd' : 'xdg-open';
          const openArgs = os === 'win32' ? ['/c', 'start', verifyUrl] : [verifyUrl];
          execFile(openCmd, openArgs, (err) => {
            if (err) mcpLog('tool:entendi_login browser open failed', { error: err });
          });

          const instructions = [
            `A browser window has been opened. Please sign in and click "Confirm Link".`,
            '',
            `Your device code is: ${newCode}`,
            `It expires at: ${expiresAt}`,
            '',
            `After confirming in the browser, call entendi_login again with code "${newCode}" to retrieve your API key.`,
          ].join('\n');
          return { content: [{ type: 'text' as const, text: instructions }] };
        }

        // Phase 2: Poll for confirmation (short polling, ~30s max)
        const maxPolls = 15;
        const pollInterval = 2000;

        for (let i = 0; i < maxPolls; i++) {
          const pollResult = await api.pollDeviceCode(code);
          mcpLog('tool:entendi_login poll result', pollResult);

          if (pollResult.status === 'confirmed' && pollResult.apiKey) {
            try {
              saveConfig({ apiKey: pollResult.apiKey, apiUrl: api.getApiUrl() });
              mcpLog('tool:entendi_login config saved to ~/.entendi/config.json');
            } catch (saveErr) {
              mcpLog('tool:entendi_login config save failed', { error: String(saveErr) });
            }

            // Notify client that tool list has changed (new auth tools available)
            try {
              mcpServer.sendToolListChanged();
              mcpLog('tool:entendi_login sent tools/list_changed notification');
            } catch (notifErr) {
              mcpLog('tool:entendi_login list_changed notification failed', { error: String(notifErr) });
            }

            const lines = [
              'Device linked successfully!',
              '',
              'API key saved to ~/.entendi/config.json',
              'Restart Claude Code for the change to take effect.',
            ];
            return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
          }

          if (pollResult.status === 'expired') {
            return { content: [{ type: 'text' as const, text: 'Device code expired. Please run entendi_login again to start over.' }], isError: true };
          }

          if (i < maxPolls - 1) {
            await new Promise(resolve => setTimeout(resolve, pollInterval));
          }
        }

        return { content: [{ type: 'text' as const, text: `Code "${code}" is still pending. Make sure you confirmed in the browser, then call entendi_login with this code again.` }] };
      } catch (err) {
        mcpLog('tool:entendi_login error', { error: err });
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: String(err) }) }], isError: true };
      }
    },
  );
  registeredTools.push({ name: 'entendi_login' });

  // --- Tool 9: entendi_health_check (always available) ---
  mcpServer.tool(
    'entendi_health_check',
    'Check Entendi system health: config file, API key, API reachability, auth validity, and DB connectivity. Works before login to show what is missing.',
    {},
    async () => {
      mcpLog('tool:entendi_health_check called');
      const configPath = join(homedir(), '.entendi', 'config.json');
      const checks: Record<string, { ok: boolean; detail: string }> = {};

      // 1. Config file exists
      const configExists = existsSync(configPath);
      checks.config = {
        ok: configExists,
        detail: configExists ? configPath : 'Not found. Run entendi_login to create.',
      };

      // 2. API key present
      const hasApiKey = !!options.apiKey;
      checks.apiKey = {
        ok: hasApiKey,
        detail: hasApiKey ? 'Present' : 'Missing. Run entendi_login to authenticate.',
      };

      // 3. API reachable + DB connected (via /health)
      try {
        const health = await api.healthCheck();
        checks.apiReachable = { ok: true, detail: `${options.apiUrl} (status: ${health.status})` };
        checks.database = {
          ok: health.db === 'connected',
          detail: health.db === 'connected' ? 'Connected' : `${health.db}: ${health.error ?? 'unknown'}`,
        };
      } catch (err) {
        checks.apiReachable = { ok: false, detail: `${options.apiUrl} — ${String(err)}` };
        checks.database = { ok: false, detail: 'Cannot check (API unreachable)' };
      }

      // 4. Auth valid (only if we have an API key and API is reachable)
      if (hasApiKey && checks.apiReachable.ok) {
        try {
          const me = await api.verifyAuth();
          checks.auth = { ok: true, detail: `Authenticated as ${(me.user as Record<string, unknown>).email ?? 'unknown'}` };
        } catch (err) {
          checks.auth = { ok: false, detail: `Auth failed: ${String(err)}` };
        }
      } else if (!hasApiKey) {
        checks.auth = { ok: false, detail: 'Skipped (no API key)' };
      } else {
        checks.auth = { ok: false, detail: 'Skipped (API unreachable)' };
      }

      const allOk = Object.values(checks).every(c => c.ok);
      const result = { healthy: allOk, checks };
      mcpLog('tool:entendi_health_check result', result);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );
  registeredTools.push({ name: 'entendi_health_check' });

  return {
    close: async () => { await mcpServer.close(); },
    getRegisteredTools: () => [...registeredTools],
    getApiClient: () => api,
    getMcpServer: () => mcpServer,
  };
}

// --- Standalone entry point ---
async function main() {
  const config = loadConfig();
  const apiUrl = config.apiUrl;
  const apiKey = config.apiKey;

  if (!apiKey) {
    process.stderr.write('[Entendi MCP] No API key found. Only entendi_login is available.\n');
    process.stderr.write('[Entendi MCP] Run entendi_login to link your account.\n');
  }

  const server = createEntendiServer({ apiUrl, apiKey });
  const transport = new StdioServerTransport();
  await server.getMcpServer().connect(transport);
  process.stderr.write(`[Entendi MCP] Server started on stdio (API: ${apiUrl}, authenticated: ${!!apiKey})\n`);

  // Graceful shutdown on SIGINT/SIGTERM
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    mcpLog(`shutdown initiated by ${signal}`);
    process.stderr.write(`[Entendi MCP] Received ${signal}, shutting down...\n`);
    try {
      await transport.close();
      await server.close();
      mcpLog(`shutdown complete (${signal})`);
    } catch (err) {
      mcpLog(`shutdown error`, { error: err });
    }
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

const isMainModule = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'));
if (isMainModule) {
  main().catch((err) => {
    process.stderr.write(`[Entendi MCP] Server error: ${String(err)}\n`);
    process.exit(1);
  });
}
