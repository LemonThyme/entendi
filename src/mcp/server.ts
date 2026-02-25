import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { StateManager } from '../core/state-manager.js';
import { handleObserve } from './tools/observe.js';
import { handleRecordEvaluation } from './tools/record-evaluation.js';
import { handleGetStatus, handleGetZPDFrontier } from './tools/query.js';
import { loadConfig } from '../config/config-loader.js';

export interface EntendiServerOptions {
  dataDir: string;
  userId?: string;
}

export interface EntendiServer {
  close(): Promise<void>;
  getRegisteredTools(): Array<{ name: string }>;
  getStateManager(): StateManager;
  /** The underlying McpServer instance, for transport connection */
  getMcpServer(): McpServer;
}

function stubResult(toolName: string) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ error: `${toolName} not yet implemented` }) }],
  };
}

export function createEntendiServer(options: EntendiServerOptions): EntendiServer {
  const { dataDir, userId = process.env.ENTENDI_USER_ID ?? process.env.USER ?? 'default' } = options;

  const mcpServer = new McpServer({
    name: 'entendi',
    version: '0.2.0',
  });

  const sm = new StateManager(dataDir, userId);

  // Track registered tools for testing/introspection
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
      const result = handleObserve(
        { concepts: args.concepts, triggerContext: args.triggerContext },
        sm,
        userId,
      );
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      };
    },
  );
  registeredTools.push({ name: 'entendi_observe' });

  // --- Tool 2: entendi_record_evaluation ---
  const resolvedConfig = loadConfig(dataDir);
  mcpServer.tool(
    'entendi_record_evaluation',
    'Record the evaluation of a probe or tutor response. Updates the knowledge graph with Bayesian scoring.',
    {
      conceptId: z.string(),
      score: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
      confidence: z.number().min(0).max(1),
      reasoning: z.string(),
      eventType: z.enum(['probe', 'tutor_phase1', 'tutor_phase4']),
    },
    async (args) => {
      const result = handleRecordEvaluation(
        {
          conceptId: args.conceptId,
          score: args.score as 0 | 1 | 2 | 3,
          confidence: args.confidence,
          reasoning: args.reasoning,
          eventType: args.eventType,
        },
        sm,
        userId,
        resolvedConfig,
      );
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      };
    },
  );
  registeredTools.push({ name: 'entendi_record_evaluation' });

  // --- Tool 3: entendi_start_tutor ---
  mcpServer.tool(
    'entendi_start_tutor',
    'Start a 4-phase Socratic tutor session for a concept.',
    {
      conceptId: z.string(),
      triggerScore: z.union([z.literal(0), z.literal(1), z.null()]).optional(),
    },
    async (_args) => stubResult('entendi_start_tutor'),
  );
  registeredTools.push({ name: 'entendi_start_tutor' });

  // --- Tool 4: entendi_advance_tutor ---
  mcpServer.tool(
    'entendi_advance_tutor',
    'Advance a tutor session to the next phase after the user responds.',
    {
      sessionId: z.string(),
      userResponse: z.string(),
      score: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]).optional(),
    },
    async (_args) => stubResult('entendi_advance_tutor'),
  );
  registeredTools.push({ name: 'entendi_advance_tutor' });

  // --- Tool 5: entendi_dismiss ---
  mcpServer.tool(
    'entendi_dismiss',
    'Cancel a pending probe, tutor offer, or abandon a tutor session.',
    {
      reason: z.enum(['user_declined', 'topic_changed', 'timeout']).optional(),
    },
    async (_args) => stubResult('entendi_dismiss'),
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
      const result = handleGetStatus({ conceptId: args.conceptId }, sm, userId);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      };
    },
  );
  registeredTools.push({ name: 'entendi_get_status' });

  // --- Tool 7: entendi_get_zpd_frontier ---
  mcpServer.tool(
    'entendi_get_zpd_frontier',
    'Get the Zone of Proximal Development frontier: concepts the user is ready to learn next.',
    {},
    async () => {
      const result = handleGetZPDFrontier(sm, userId);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      };
    },
  );
  registeredTools.push({ name: 'entendi_get_zpd_frontier' });

  return {
    close: async () => { sm.save(); await mcpServer.close(); },
    getRegisteredTools: () => [...registeredTools],
    getStateManager: () => sm,
    getMcpServer: () => mcpServer,
  };
}

// --- Standalone entry point ---
async function main() {
  const dataDir = process.env.ENTENDI_DATA_DIR ?? '.entendi';
  const server = createEntendiServer({ dataDir });
  const transport = new StdioServerTransport();
  await server.getMcpServer().connect(transport);
  process.stderr.write('[Entendi MCP] Server started on stdio\n');
}

// Only run main when invoked directly
const isMainModule = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'));
if (isMainModule) {
  main().catch((err) => {
    process.stderr.write(`[Entendi MCP] Server error: ${String(err)}\n`);
    process.exit(1);
  });
}
