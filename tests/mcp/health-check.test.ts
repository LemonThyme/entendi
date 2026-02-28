import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEntendiServer } from '../../src/mcp/server.js';

vi.mock('fs', () => ({
  appendFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  existsSync: vi.fn(() => true),
}));

const API_URL = 'http://localhost:9876';
let fetchSpy: ReturnType<typeof vi.spyOn>;

function mockJsonResponse(data: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  }));
}

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, 'fetch');
});

afterEach(() => {
  fetchSpy.mockRestore();
});

describe('entendi_health_check tool registration', () => {
  it('is registered even without auth', () => {
    const server = createEntendiServer({ apiUrl: API_URL });
    const toolNames = server.getRegisteredTools().map(t => t.name);
    expect(toolNames).toContain('entendi_health_check');
  });

  it('is registered with auth', () => {
    const server = createEntendiServer({ apiUrl: API_URL, apiKey: 'valid-key' });
    const toolNames = server.getRegisteredTools().map(t => t.name);
    expect(toolNames).toContain('entendi_health_check');
  });

  it('unauthenticated server only has login and health_check', () => {
    const server = createEntendiServer({ apiUrl: API_URL });
    const toolNames = server.getRegisteredTools().map(t => t.name);
    expect(toolNames).toEqual(['entendi_login', 'entendi_health_check']);
  });
});

describe('API client healthCheck', () => {
  it('returns health data when API is reachable', async () => {
    fetchSpy.mockImplementation(() => mockJsonResponse({ status: 'ok', db: 'connected' }));

    const server = createEntendiServer({ apiUrl: API_URL, apiKey: 'key' });
    const health = await server.getApiClient().healthCheck();

    expect(health.status).toBe('ok');
    expect(health.db).toBe('connected');
    expect(fetchSpy).toHaveBeenCalledWith(
      `${API_URL}/health`,
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('returns degraded status when DB is down', async () => {
    fetchSpy.mockImplementation(() =>
      mockJsonResponse({ status: 'degraded', db: 'unreachable', error: 'connection refused' }, 503),
    );

    const server = createEntendiServer({ apiUrl: API_URL, apiKey: 'key' });
    const health = await server.getApiClient().healthCheck();

    expect(health.status).toBe('degraded');
    expect(health.db).toBe('unreachable');
    expect(health.error).toBe('connection refused');
  });

  it('throws when API is unreachable', async () => {
    fetchSpy.mockImplementation(() => Promise.reject(new TypeError('fetch failed')));

    const server = createEntendiServer({ apiUrl: API_URL, apiKey: 'key' });
    await expect(server.getApiClient().healthCheck()).rejects.toThrow('fetch failed');
  });
});

describe('API client verifyAuth', () => {
  it('returns user info with valid API key', async () => {
    fetchSpy.mockImplementation(() =>
      mockJsonResponse({ user: { email: 'test@entendi.dev', id: 'u1' } }),
    );

    const server = createEntendiServer({ apiUrl: API_URL, apiKey: 'valid-key' });
    const me = await server.getApiClient().verifyAuth();

    expect(me.user).toBeDefined();
    expect((me.user as Record<string, unknown>).email).toBe('test@entendi.dev');
  });

  it('throws on 401 with invalid API key', async () => {
    fetchSpy.mockImplementation(() =>
      Promise.resolve(new Response('Unauthorized', { status: 401 })),
    );

    const server = createEntendiServer({ apiUrl: API_URL, apiKey: 'bad-key' });
    await expect(server.getApiClient().verifyAuth()).rejects.toThrow(/401/);
  });
});
