import { beforeEach, describe, expect, it } from 'vitest';
import { createEntendiServer } from '../../../src/mcp/server.js';

describe('MCP App resource registration', () => {
  let server: ReturnType<typeof createEntendiServer>;

  beforeEach(() => {
    server = createEntendiServer({
      apiUrl: 'http://localhost:3456',
      apiKey: 'test-key',
    });
  });

  it('registers entendi_get_status tool', () => {
    const tools = server.getRegisteredTools();
    expect(tools.some(t => t.name === 'entendi_get_status')).toBe(true);
  });

  it('registers entendi_get_zpd_frontier tool', () => {
    const tools = server.getRegisteredTools();
    expect(tools.some(t => t.name === 'entendi_get_zpd_frontier')).toBe(true);
  });

  it('registers entendi_observe tool', () => {
    const tools = server.getRegisteredTools();
    expect(tools.some(t => t.name === 'entendi_observe')).toBe(true);
  });
});
