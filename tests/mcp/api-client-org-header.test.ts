import { afterEach, describe, expect, it, vi } from 'vitest';
import { EntendiApiClient } from '../../src/mcp/api-client.js';

vi.mock('fs', () => ({
  appendFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

describe('EntendiApiClient X-Org-Id header', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('includes X-Org-Id header when orgId is set', async () => {
    let capturedHeaders: Record<string, string> = {};
    vi.stubGlobal('fetch', vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      capturedHeaders = Object.fromEntries(
        Object.entries(init.headers as Record<string, string>),
      );
      return Promise.resolve({
        ok: true,
        json: async () => ({ status: 'ok' }),
      });
    }));

    const client = new EntendiApiClient({
      apiUrl: 'http://localhost:3456',
      apiKey: 'test-key',
      orgId: 'org-123',
      retry: { maxRetries: 0 },
    });

    await client.getStatus();
    expect(capturedHeaders['X-Org-Id']).toBe('org-123');
    expect(capturedHeaders['x-api-key']).toBe('test-key');
  });

  it('omits X-Org-Id header when orgId is not set', async () => {
    let capturedHeaders: Record<string, string> = {};
    vi.stubGlobal('fetch', vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      capturedHeaders = Object.fromEntries(
        Object.entries(init.headers as Record<string, string>),
      );
      return Promise.resolve({
        ok: true,
        json: async () => ({ status: 'ok' }),
      });
    }));

    const client = new EntendiApiClient({
      apiUrl: 'http://localhost:3456',
      apiKey: 'test-key',
      retry: { maxRetries: 0 },
    });

    await client.getStatus();
    expect(capturedHeaders['X-Org-Id']).toBeUndefined();
  });

  it('sends X-Org-Id on POST requests too', async () => {
    let capturedHeaders: Record<string, string> = {};
    vi.stubGlobal('fetch', vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      capturedHeaders = Object.fromEntries(
        Object.entries(init.headers as Record<string, string>),
      );
      return Promise.resolve({
        ok: true,
        json: async () => ({ shouldProbe: false }),
      });
    }));

    const client = new EntendiApiClient({
      apiUrl: 'http://localhost:3456',
      apiKey: 'test-key',
      orgId: 'org-456',
      retry: { maxRetries: 0 },
    });

    await client.observe({
      concepts: [{ id: 'react-hooks', source: 'llm' }],
      triggerContext: 'test',
    });
    expect(capturedHeaders['X-Org-Id']).toBe('org-456');
  });
});
