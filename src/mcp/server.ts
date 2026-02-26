import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { appendFileSync, mkdirSync } from 'fs';
import { execFile } from 'child_process';
import { join } from 'path';
import { homedir } from 'os';
import { platform } from 'os';
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
  const dataStr = data !== undefined ? ` ${JSON.stringify(data)}` : '';
  try {
    appendFileSync(MCP_LOG_FILE, `[${ts}] [mcp] ${message}${dataStr}\n`);
  } catch {}
}

export interface EntendiServerOptions {
  /** API base URL (e.g. http://localhost:3456 or https://api.entendi.dev) */
  apiUrl: string;
  /** API key for authentication */
  apiKey: string;
}

export interface EntendiServer {
  close(): Promise<void>;
  getRegisteredTools(): Array<{ name: string }>;
  getApiClient(): EntendiApiClient;
  /** The underlying McpServer instance, for transport connection */
  getMcpServer(): McpServer;
}

export function createEntendiServer(options: EntendiServerOptions): EntendiServer {
  const mcpServer = new McpServer({
    name: 'entendi',
    version: '0.2.0',
  });

  const api = new EntendiApiClient({
    apiUrl: options.apiUrl,
    apiKey: options.apiKey,
  });

  const registeredTools: Array<{ name: string }> = [];

  // --- Tool 1: entendi_observe ---
  mcpServer.tool(
    'entendi_observe',
    'Observe concepts detected after a tool use. Determines if a comprehension probe is appropriate.',
    {
      concepts: z.array(z.object({
        id: z.string(),
        source: z.enum(['package', 'ast', 'llm']),
      })),
      triggerContext: z.string(),
    },
    async (args) => {
      mcpLog('tool:entendi_observe called', args);
      try {
        const result = await api.observe({
          concepts: args.concepts,
          triggerContext: args.triggerContext,
        });
        mcpLog('tool:entendi_observe result', result);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      } catch (err) {
        mcpLog('tool:entendi_observe error', { error: String(err) });
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: String(err) }) }], isError: true };
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
      probeToken: z.object({
        tokenId: z.string(),
        userId: z.string(),
        conceptId: z.string(),
        depth: z.coerce.number(),
        evaluationCriteria: z.string(),
        issuedAt: z.string(),
        expiresAt: z.string(),
        signature: z.string(),
      }).optional(),
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
        mcpLog('tool:entendi_record_evaluation error', { error: String(err) });
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: String(err) }) }], isError: true };
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
        mcpLog('tool:entendi_start_tutor error', { error: String(err) });
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: String(err) }) }], isError: true };
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
        mcpLog('tool:entendi_advance_tutor error', { error: String(err) });
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: String(err) }) }], isError: true };
      }
    },
  );
  registeredTools.push({ name: 'entendi_advance_tutor' });

  // --- Tool 5: entendi_dismiss ---
  mcpServer.tool(
    'entendi_dismiss',
    'Cancel a pending probe, tutor offer, or abandon a tutor session.',
    {
      reason: z.enum(['user_declined', 'topic_changed', 'timeout']).optional(),
    },
    async (args) => {
      mcpLog('tool:entendi_dismiss called', args);
      try {
        const result = await api.dismiss({
          reason: args.reason as 'user_declined' | 'topic_changed' | 'timeout' | undefined,
        });
        mcpLog('tool:entendi_dismiss result', result);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      } catch (err) {
        mcpLog('tool:entendi_dismiss error', { error: String(err) });
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: String(err) }) }], isError: true };
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
        mcpLog('tool:entendi_get_status error', { error: String(err) });
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: String(err) }) }], isError: true };
      }
    },
  );
  registeredTools.push({ name: 'entendi_get_status' });

  // --- Tool 7: entendi_get_zpd_frontier ---
  mcpServer.tool(
    'entendi_get_zpd_frontier',
    'Get the Zone of Proximal Development frontier: concepts the user is ready to learn next.',
    {},
    async () => {
      mcpLog('tool:entendi_get_zpd_frontier called');
      try {
        const result = await api.getZpdFrontier();
        mcpLog('tool:entendi_get_zpd_frontier result', result);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      } catch (err) {
        mcpLog('tool:entendi_get_zpd_frontier error', { error: String(err) });
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: String(err) }) }], isError: true };
      }
    },
  );
  registeredTools.push({ name: 'entendi_get_zpd_frontier' });

  // --- Tool 8: entendi_login ---
  mcpServer.tool(
    'entendi_login',
    'Link this device to your Entendi account. Opens a browser for authentication and returns an API key.',
    {},
    async () => {
      mcpLog('tool:entendi_login called');
      try {
        // Step 1: Create device code
        const { code, verifyUrl, expiresAt } = await api.createDeviceCode();
        mcpLog('tool:entendi_login device code created', { code, verifyUrl });

        // Step 2: Open browser
        const os = platform();
        const openCmd = os === 'darwin' ? 'open' : os === 'win32' ? 'cmd' : 'xdg-open';
        const openArgs = os === 'win32' ? ['/c', 'start', verifyUrl] : [verifyUrl];
        execFile(openCmd, openArgs, (err) => {
          if (err) mcpLog('tool:entendi_login browser open failed', { error: String(err) });
        });

        // Step 3: Poll until confirmed or expired
        const pollInterval = 2000;
        const deadline = new Date(expiresAt).getTime();

        while (Date.now() < deadline) {
          await new Promise(resolve => setTimeout(resolve, pollInterval));
          const pollResult = await api.pollDeviceCode(code);
          mcpLog('tool:entendi_login poll result', pollResult);

          if (pollResult.status === 'confirmed' && pollResult.apiKey) {
            const instructions = [
              `Device linked successfully! Your API key: ${pollResult.apiKey}`,
              '',
              'To configure the plugin, run:',
              `  claude plugin configure entendi --env ENTENDI_API_KEY=${pollResult.apiKey}`,
            ].join('\n');
            return { content: [{ type: 'text' as const, text: instructions }] };
          }

          if (pollResult.status === 'expired') {
            return { content: [{ type: 'text' as const, text: 'Device code expired. Please try again.' }], isError: true };
          }
        }

        return { content: [{ type: 'text' as const, text: 'Device code expired (timeout). Please try again.' }], isError: true };
      } catch (err) {
        mcpLog('tool:entendi_login error', { error: String(err) });
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: String(err) }) }], isError: true };
      }
    },
  );
  registeredTools.push({ name: 'entendi_login' });

  return {
    close: async () => { await mcpServer.close(); },
    getRegisteredTools: () => [...registeredTools],
    getApiClient: () => api,
    getMcpServer: () => mcpServer,
  };
}

// --- Standalone entry point ---
async function main() {
  const apiUrl = process.env.ENTENDI_API_URL ?? 'http://localhost:3456';
  const apiKey = process.env.ENTENDI_API_KEY;

  if (!apiKey) {
    process.stderr.write('[Entendi MCP] Error: ENTENDI_API_KEY environment variable is required\n');
    process.stderr.write('[Entendi MCP] Generate an API key at your Entendi dashboard\n');
    process.exit(1);
  }

  const server = createEntendiServer({ apiUrl, apiKey });
  const transport = new StdioServerTransport();
  await server.getMcpServer().connect(transport);
  process.stderr.write(`[Entendi MCP] Server started on stdio (API: ${apiUrl})\n`);
}

const isMainModule = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'));
if (isMainModule) {
  main().catch((err) => {
    process.stderr.write(`[Entendi MCP] Server error: ${String(err)}\n`);
    process.exit(1);
  });
}
