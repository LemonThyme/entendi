import { RESOURCE_MIME_TYPE, registerAppResource, registerAppTool } from '@modelcontextprotocol/ext-apps/server';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { Hono } from 'hono';
import { z } from 'zod';

import { getFrontierViewHtml } from '../../mcp/views/frontier.js';
import { getProbeViewHtml } from '../../mcp/views/probe.js';
import { getStatusViewHtml } from '../../mcp/views/status.js';
import type { Env } from '../index.js';

/**
 * Remote MCP endpoint using Streamable HTTP transport.
 *
 * Stateless: creates a new McpServer + transport per request.
 * Tool handlers proxy to the existing internal API routes, forwarding auth headers.
 */

/** Build auth headers from the incoming request to forward to internal routes */
function extractAuthHeaders(req: Request): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const auth = req.headers.get('Authorization');
  if (auth) headers['Authorization'] = auth;
  const apiKey = req.headers.get('x-api-key');
  if (apiKey) headers['x-api-key'] = apiKey;
  const cookie = req.headers.get('Cookie');
  if (cookie) headers['Cookie'] = cookie;
  return headers;
}

/** Call an internal API route through the Hono app and return parsed JSON */
async function internalFetch(
  app: Hono<Env>,
  method: string,
  path: string,
  headers: Record<string, string>,
  body?: unknown,
): Promise<{ status: number; json: unknown }> {
  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  const url = new URL(path, 'http://localhost');
  const res = await app.request(url.pathname + url.search, init);
  const json = await res.json();
  return { status: res.status, json };
}

/** MCP tool result helper */
function toolResult(data: unknown, isError = false) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data) }],
    ...(isError && { isError: true }),
  };
}

function registerTools(
  server: McpServer,
  app: Hono<Env>,
  authHeaders: Record<string, string>,
) {
  // --- App resources (UI views) ---
  registerAppResource(server, 'Entendi Status Dashboard', 'ui://entendi/status',
    { description: 'Interactive mastery dashboard' },
    async () => ({
      contents: [{ uri: 'ui://entendi/status', mimeType: RESOURCE_MIME_TYPE, text: getStatusViewHtml() }],
    }),
  );

  registerAppResource(server, 'Entendi ZPD Frontier', 'ui://entendi/frontier',
    { description: 'Zone of Proximal Development learning recommendations' },
    async () => ({
      contents: [{ uri: 'ui://entendi/frontier', mimeType: RESOURCE_MIME_TYPE, text: getFrontierViewHtml() }],
    }),
  );

  registerAppResource(server, 'Entendi Probe', 'ui://entendi/probe',
    { description: 'Interactive comprehension probe' },
    async () => ({
      contents: [{ uri: 'ui://entendi/probe', mimeType: RESOURCE_MIME_TYPE, text: getProbeViewHtml() }],
    }),
  );

  // --- entendi_health_check (no auth required) ---
  server.tool(
    'entendi_health_check',
    'Check Entendi system health: API reachability and DB connectivity.',
    {},
    async () => {
      const { json } = await internalFetch(app, 'GET', '/health', authHeaders);
      return toolResult(json);
    },
  );

  // --- entendi_get_status (App tool — renders status UI) ---
  registerAppTool(
    server,
    'entendi_get_status',
    {
      description: 'Query mastery state for a specific concept or get an overview of all concepts.',
      inputSchema: { conceptId: z.string().optional() },
      _meta: { ui: { resourceUri: 'ui://entendi/status' } },
    },
    async (args) => {
      const path = args.conceptId
        ? `/api/mcp/status?conceptId=${encodeURIComponent(args.conceptId)}`
        : '/api/mcp/status';
      const { status, json } = await internalFetch(app, 'GET', path, authHeaders);
      return toolResult(json, status !== 200);
    },
  );

  // --- entendi_observe (App tool — renders probe UI) ---
  registerAppTool(
    server,
    'entendi_observe',
    {
      description: 'Observe concepts detected after a tool use. Determines if a comprehension probe is appropriate.',
      inputSchema: {
        concepts: z.preprocess(
          (v) => {
            if (v === undefined || v === null) return [];
            if (typeof v === 'string') try { return JSON.parse(v); } catch { return []; }
            return v;
          },
          z.array(z.object({
            id: z.string(),
            source: z.enum(['package', 'ast', 'llm']).default('llm'),
          })).default([]),
        ),
        triggerContext: z.string().default('(not provided)'),
        primaryConceptId: z.string().optional(),
        repoUrl: z.string().url().optional(),
      },
      _meta: { ui: { resourceUri: 'ui://entendi/probe' } },
    },
    async (args) => {
      if (!args.concepts || args.concepts.length === 0) {
        return toolResult({ shouldProbe: false, conceptsObserved: 0 });
      }
      const { status, json } = await internalFetch(app, 'POST', '/api/mcp/observe', authHeaders, {
        concepts: args.concepts,
        triggerContext: args.triggerContext,
        primaryConceptId: args.primaryConceptId,
        repoUrl: args.repoUrl,
      });
      return toolResult(json, status !== 200);
    },
  );

  // --- entendi_record_evaluation ---
  server.tool(
    'entendi_record_evaluation',
    'Record the evaluation of a probe or tutor response. Updates the knowledge graph with Bayesian scoring.',
    {
      conceptId: z.string(),
      score: z.number().int().min(0).max(3),
      confidence: z.number().min(0).max(1),
      reasoning: z.string(),
      eventType: z.enum(['probe', 'tutor_phase1', 'tutor_phase4']),
      probeToken: z.object({
        tokenId: z.string(),
        userId: z.string(),
        conceptId: z.string(),
        depth: z.number(),
        evaluationCriteria: z.string(),
        issuedAt: z.string(),
        expiresAt: z.string(),
        signature: z.string(),
      }).optional(),
      responseText: z.string().optional(),
    },
    async (args) => {
      const { status, json } = await internalFetch(app, 'POST', '/api/mcp/record-evaluation', authHeaders, args);
      return toolResult(json, status !== 200);
    },
  );

  // --- entendi_start_tutor ---
  server.tool(
    'entendi_start_tutor',
    'Start a 4-phase Socratic tutor session for a concept.',
    {
      conceptId: z.string(),
      triggerScore: z.number().int().min(0).max(1).nullable().optional(),
    },
    async (args) => {
      const { status, json } = await internalFetch(app, 'POST', '/api/mcp/tutor/start', authHeaders, {
        conceptId: args.conceptId,
        triggerScore: args.triggerScore,
      });
      return toolResult(json, status !== 200);
    },
  );

  // --- entendi_advance_tutor ---
  server.tool(
    'entendi_advance_tutor',
    'Advance a tutor session to the next phase after the user responds.',
    {
      sessionId: z.string(),
      userResponse: z.string(),
      score: z.number().int().min(0).max(3).optional(),
      confidence: z.number().min(0).max(1).optional(),
      reasoning: z.string().optional(),
      misconception: z.string().optional(),
    },
    async (args) => {
      const { status, json } = await internalFetch(app, 'POST', '/api/mcp/tutor/advance', authHeaders, args);
      return toolResult(json, status !== 200);
    },
  );

  // --- entendi_dismiss ---
  server.tool(
    'entendi_dismiss',
    'Dismiss a pending probe or tutor session with a categorized reason.',
    {
      reason: z.enum(['topic_change', 'busy', 'claimed_expertise']),
      note: z.string().max(500).optional(),
    },
    async (args) => {
      const { status, json } = await internalFetch(app, 'POST', '/api/mcp/dismiss', authHeaders, args);
      return toolResult(json, status !== 200);
    },
  );

  // --- entendi_get_zpd_frontier (App tool — renders frontier UI) ---
  registerAppTool(
    server,
    'entendi_get_zpd_frontier',
    {
      description: 'Get the Zone of Proximal Development frontier: concepts the user is ready to learn next.',
      inputSchema: {
        limit: z.number().int().min(1).max(100).optional(),
        domain: z.string().optional(),
        includeUnassessed: z.boolean().optional(),
      },
      _meta: { ui: { resourceUri: 'ui://entendi/frontier' } },
    },
    async (args) => {
      const params = new URLSearchParams();
      if (args.limit !== undefined) params.set('limit', String(args.limit));
      if (args.domain) params.set('domain', args.domain);
      if (args.includeUnassessed) params.set('includeUnassessed', 'true');
      const qs = params.toString();
      const path = `/api/mcp/zpd-frontier${qs ? `?${qs}` : ''}`;
      const { status, json } = await internalFetch(app, 'GET', path, authHeaders);
      return toolResult(json, status !== 200);
    },
  );

  // --- entendi_login (stub — not available remotely) ---
  server.tool(
    'entendi_login',
    'Not available via remote MCP. Use the dashboard or CLI to authenticate.',
    { code: z.string().optional() },
    async () => toolResult({
      message: 'The login flow is not available via remote MCP. Please authenticate via the dashboard at https://entendi.dev or use the CLI plugin.',
    }),
  );
}

/**
 * Create the remote MCP route handler.
 * Requires a reference to the full Hono app for internal route proxying.
 */
export function createMcpRemoteRoutes(parentApp: Hono<Env>): Hono<Env> {
  const router = new Hono<Env>();

  router.all('/', async (c) => {
    const authHeaders = extractAuthHeaders(c.req.raw);

    const server = new McpServer({
      name: 'entendi',
      version: '0.4.1',
    });

    registerTools(server, parentApp, authHeaders);

    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless mode
      enableJsonResponse: true,
    });

    await server.connect(transport);

    try {
      return await transport.handleRequest(c.req.raw);
    } finally {
      await transport.close();
      await server.close();
    }
  });

  return router;
}
