import { describe, it, expect } from 'vitest';
import { createEntendiServer, type EntendiServer } from '../../src/mcp/server.js';

const testOptions = { apiUrl: 'http://localhost:3456', apiKey: 'test-key' };

describe('MCP Server', () => {
  it('exports createEntendiServer function', () => {
    expect(typeof createEntendiServer).toBe('function');
  });

  it('creates a server with close method', () => {
    const server = createEntendiServer(testOptions);
    expect(server).toBeDefined();
    expect(typeof server.close).toBe('function');
  });

  it('creates a server with getRegisteredTools method', () => {
    const server = createEntendiServer(testOptions);
    expect(typeof server.getRegisteredTools).toBe('function');
  });

  it('creates a server with getApiClient method', () => {
    const server = createEntendiServer(testOptions);
    expect(typeof server.getApiClient).toBe('function');
    expect(server.getApiClient()).toBeDefined();
  });

  it('registers all 8 entendi tools', () => {
    const server = createEntendiServer(testOptions);
    const tools = server.getRegisteredTools();
    const toolNames = tools.map((t: { name: string }) => t.name);
    expect(toolNames).toContain('entendi_observe');
    expect(toolNames).toContain('entendi_record_evaluation');
    expect(toolNames).toContain('entendi_start_tutor');
    expect(toolNames).toContain('entendi_advance_tutor');
    expect(toolNames).toContain('entendi_dismiss');
    expect(toolNames).toContain('entendi_get_status');
    expect(toolNames).toContain('entendi_get_zpd_frontier');
    expect(toolNames).toContain('entendi_login');
    expect(toolNames).toHaveLength(8);
  });

  it('returns a copy of registered tools (not internal array)', () => {
    const server = createEntendiServer(testOptions);
    const tools1 = server.getRegisteredTools();
    const tools2 = server.getRegisteredTools();
    expect(tools1).not.toBe(tools2);
    expect(tools1).toEqual(tools2);
  });

  it('can create multiple independent server instances', () => {
    const server1 = createEntendiServer(testOptions);
    const server2 = createEntendiServer({ apiUrl: 'http://localhost:3457', apiKey: 'other-key' });
    expect(server1.getRegisteredTools()).toHaveLength(8);
    expect(server2.getRegisteredTools()).toHaveLength(8);
    expect(server1.getApiClient()).not.toBe(server2.getApiClient());
  });
});
