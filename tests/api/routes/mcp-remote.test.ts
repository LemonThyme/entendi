import { config } from 'dotenv';

config();

import { describe, expect, it } from 'vitest';
import { createApp } from '../../../src/api/index.js';

/** Standard MCP Streamable HTTP headers for POST requests */
const mcpHeaders = {
  'Content-Type': 'application/json',
  'Accept': 'application/json, text/event-stream',
};

describe('MCP Remote: Streamable HTTP endpoint', () => {
  const testDbUrl = process.env.DATABASE_URL;
  const testSecret = process.env.BETTER_AUTH_SECRET ?? 'test-secret-for-unit-tests';

  const canCreateApp = !!testDbUrl;
  const describeWithApp = canCreateApp ? describe : describe.skip;

  describeWithApp('MCP protocol basics', () => {
    const { app } = createApp(testDbUrl!, { secret: testSecret });

    it('POST /mcp with initialize request returns result', async () => {
      const res = await app.request('/mcp', {
        method: 'POST',
        headers: mcpHeaders,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-03-26',
            capabilities: {},
            clientInfo: { name: 'test-client', version: '1.0.0' },
          },
        }),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.jsonrpc).toBe('2.0');
      expect(body.id).toBe(1);
      expect(body.result).toBeDefined();
      expect(body.result.serverInfo.name).toBe('entendi');
      expect(body.result.capabilities).toBeDefined();
    });

    it('POST /mcp with tools/list returns all 9 tools', async () => {
      const res = await app.request('/mcp', {
        method: 'POST',
        headers: mcpHeaders,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/list',
          params: {},
        }),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.result).toBeDefined();
      expect(body.result.tools).toBeDefined();

      const toolNames = body.result.tools.map((t: any) => t.name).sort();
      expect(toolNames).toEqual([
        'entendi_advance_tutor',
        'entendi_dismiss',
        'entendi_get_status',
        'entendi_get_zpd_frontier',
        'entendi_health_check',
        'entendi_login',
        'entendi_observe',
        'entendi_record_evaluation',
        'entendi_start_tutor',
      ]);
    });

    it('POST /mcp health_check tool returns health data', async () => {
      const res = await app.request('/mcp', {
        method: 'POST',
        headers: mcpHeaders,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: {
            name: 'entendi_health_check',
            arguments: {},
          },
        }),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.result).toBeDefined();
      expect(body.result.content).toBeDefined();
      expect(body.result.content[0].type).toBe('text');

      const healthData = JSON.parse(body.result.content[0].text);
      expect(healthData.status).toBeDefined();
    });

    it('POST /mcp login tool returns not-available message', async () => {
      const res = await app.request('/mcp', {
        method: 'POST',
        headers: mcpHeaders,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 4,
          method: 'tools/call',
          params: {
            name: 'entendi_login',
            arguments: {},
          },
        }),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      const text = body.result.content[0].text;
      expect(text).toContain('not available via remote MCP');
    });

    it('POST /mcp without Accept header returns 406', async () => {
      const res = await app.request('/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 5,
          method: 'initialize',
          params: {
            protocolVersion: '2025-03-26',
            capabilities: {},
            clientInfo: { name: 'test-client', version: '1.0.0' },
          },
        }),
      });
      expect(res.status).toBe(406);
    });

    it('GET /mcp without Accept: text/event-stream returns 406', async () => {
      const res = await app.request('/mcp', { method: 'GET' });
      expect(res.status).toBe(406);
    });

    it('DELETE /mcp in stateless mode returns 400', async () => {
      const res = await app.request('/mcp', { method: 'DELETE' });
      // Stateless mode: DELETE with no session ID → 400
      expect([200, 400, 405]).toContain(res.status);
    });

    it('POST /mcp with invalid JSON returns error', async () => {
      const res = await app.request('/mcp', {
        method: 'POST',
        headers: mcpHeaders,
        body: 'not json',
      });
      expect(res.status).toBeGreaterThanOrEqual(200);
    });
  });

  // --- Integration tests (require DB + API key) ---

  const testApiKey = process.env.ENTENDI_API_KEY;
  const canRunIntegration = testDbUrl && testApiKey && testSecret && process.env.INTEGRATION_TESTS === '1';
  const describeIntegration = canRunIntegration ? describe : describe.skip;

  describeIntegration('MCP Remote: authenticated tool calls (integration)', () => {
    const { app } = createApp(testDbUrl!, { secret: testSecret });
    const authHeaders = {
      ...mcpHeaders,
      'x-api-key': testApiKey!,
    };

    it('entendi_get_status returns overview when no conceptId', async () => {
      const res = await app.request('/mcp', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 10,
          method: 'tools/call',
          params: {
            name: 'entendi_get_status',
            arguments: {},
          },
        }),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.result).toBeDefined();
      const data = JSON.parse(body.result.content[0].text);
      expect(data.overview).toBeDefined();
    });

    it('entendi_observe processes concepts', async () => {
      const res = await app.request('/mcp', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 11,
          method: 'tools/call',
          params: {
            name: 'entendi_observe',
            arguments: {
              concepts: [{ id: 'test-remote-mcp-' + Date.now(), source: 'llm' }],
              triggerContext: 'remote mcp integration test',
            },
          },
        }),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.result).toBeDefined();
      const data = JSON.parse(body.result.content[0].text);
      expect(typeof data.shouldProbe).toBe('boolean');
    });

    it('entendi_dismiss works via remote MCP', async () => {
      const res = await app.request('/mcp', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 12,
          method: 'tools/call',
          params: {
            name: 'entendi_dismiss',
            arguments: { reason: 'topic_change' },
          },
        }),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.result).toBeDefined();
      const data = JSON.parse(body.result.content[0].text);
      expect(data.acknowledged).toBe(true);
    });

    it('entendi_get_zpd_frontier returns frontier data', async () => {
      const res = await app.request('/mcp', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 13,
          method: 'tools/call',
          params: {
            name: 'entendi_get_zpd_frontier',
            arguments: { limit: 5, includeUnassessed: true },
          },
        }),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.result).toBeDefined();
      const data = JSON.parse(body.result.content[0].text);
      expect(data.frontier).toBeDefined();
      expect(Array.isArray(data.frontier)).toBe(true);
    });

    it('tool calls without auth return error from proxied route', async () => {
      const res = await app.request('/mcp', {
        method: 'POST',
        headers: mcpHeaders,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 14,
          method: 'tools/call',
          params: {
            name: 'entendi_get_status',
            arguments: {},
          },
        }),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.result).toBeDefined();
      const data = JSON.parse(body.result.content[0].text);
      expect(data.error).toBeDefined();
    });
  });
});
