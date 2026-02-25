import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createEntendiServer, type EntendiServer } from '../../src/mcp/server.js';

describe('MCP Server Skeleton', () => {
  let dataDir: string;
  let server: EntendiServer;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'entendi-mcp-server-'));
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('exports createEntendiServer function', () => {
    expect(typeof createEntendiServer).toBe('function');
  });

  it('creates a server with close method', () => {
    server = createEntendiServer({ dataDir });
    expect(server).toBeDefined();
    expect(typeof server.close).toBe('function');
  });

  it('creates a server with getRegisteredTools method', () => {
    server = createEntendiServer({ dataDir });
    expect(typeof server.getRegisteredTools).toBe('function');
  });

  it('creates a server with getStateManager method', () => {
    server = createEntendiServer({ dataDir });
    expect(typeof server.getStateManager).toBe('function');
    expect(server.getStateManager()).toBeDefined();
  });

  it('registers all 7 entendi tools', () => {
    server = createEntendiServer({ dataDir });
    const tools = server.getRegisteredTools();
    const toolNames = tools.map((t: { name: string }) => t.name);
    expect(toolNames).toContain('entendi_observe');
    expect(toolNames).toContain('entendi_record_evaluation');
    expect(toolNames).toContain('entendi_start_tutor');
    expect(toolNames).toContain('entendi_advance_tutor');
    expect(toolNames).toContain('entendi_dismiss');
    expect(toolNames).toContain('entendi_get_status');
    expect(toolNames).toContain('entendi_get_zpd_frontier');
    expect(toolNames).toHaveLength(7);
  });

  it('returns a copy of registered tools (not internal array)', () => {
    server = createEntendiServer({ dataDir });
    const tools1 = server.getRegisteredTools();
    const tools2 = server.getRegisteredTools();
    expect(tools1).not.toBe(tools2);
    expect(tools1).toEqual(tools2);
  });

  it('can create multiple independent server instances', () => {
    const dataDir2 = mkdtempSync(join(tmpdir(), 'entendi-mcp-server2-'));
    try {
      const server1 = createEntendiServer({ dataDir });
      const server2 = createEntendiServer({ dataDir: dataDir2 });
      expect(server1.getRegisteredTools()).toHaveLength(7);
      expect(server2.getRegisteredTools()).toHaveLength(7);
      expect(server1.getStateManager()).not.toBe(server2.getStateManager());
    } finally {
      rmSync(dataDir2, { recursive: true, force: true });
    }
  });
});
