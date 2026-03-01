import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const { TEST_HOME } = vi.hoisted(() => ({
  TEST_HOME: '/tmp/entendi-session-end-test',
}));

vi.mock('../../src/shared/config.js', () => ({
  loadConfig: vi.fn(() => ({ apiUrl: 'http://localhost:3456', apiKey: 'test-key' })),
  saveConfig: vi.fn(),
}));

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return { ...actual, homedir: () => TEST_HOME };
});

// Dynamic import so mocks are applied first
const { cleanupSession } = await import('../../src/hooks/session-end.js');

describe('session-end local dismiss marker', () => {
  beforeAll(() => {
    mkdirSync(join(TEST_HOME, '.entendi'), { recursive: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // Clean up marker files between tests
    const markerPath = join(TEST_HOME, '.entendi', 'pending-dismiss.json');
    try { rmSync(markerPath, { force: true }); } catch {}
  });

  afterAll(() => {
    rmSync(TEST_HOME, { recursive: true, force: true });
  });

  it('writes pending-dismiss.json when dismiss API call fails', async () => {
    // First fetch (pending-action) returns a pending probe
    // Second fetch (dismiss) returns 500
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          pending: { type: 'awaiting_probe_response', conceptId: 'oauth' },
        }),
      })
      .mockResolvedValueOnce({ ok: false, status: 500 });
    vi.stubGlobal('fetch', fetchMock);

    await cleanupSession();

    const markerPath = join(TEST_HOME, '.entendi', 'pending-dismiss.json');
    expect(existsSync(markerPath)).toBe(true);
    const marker = JSON.parse(readFileSync(markerPath, 'utf-8'));
    expect(marker.conceptId).toBe('oauth');
    expect(marker.reason).toBe('session_ended');
    expect(marker.ts).toBeGreaterThan(0);
  });

  it('writes pending-dismiss.json when dismiss API call throws', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          pending: { type: 'awaiting_probe_response', conceptId: 'redis' },
        }),
      })
      .mockRejectedValueOnce(new Error('ECONNREFUSED'));
    vi.stubGlobal('fetch', fetchMock);

    await cleanupSession();

    const markerPath = join(TEST_HOME, '.entendi', 'pending-dismiss.json');
    expect(existsSync(markerPath)).toBe(true);
    const marker = JSON.parse(readFileSync(markerPath, 'utf-8'));
    expect(marker.conceptId).toBe('redis');
  });

  it('does not write marker when dismiss succeeds', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          pending: { type: 'awaiting_probe_response', conceptId: 'oauth' },
        }),
      })
      .mockResolvedValueOnce({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    await cleanupSession();

    const markerPath = join(TEST_HOME, '.entendi', 'pending-dismiss.json');
    expect(existsSync(markerPath)).toBe(false);
  });

  it('does not write marker when no pending action exists', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ pending: null }),
    }));

    await cleanupSession();

    const markerPath = join(TEST_HOME, '.entendi', 'pending-dismiss.json');
    expect(existsSync(markerPath)).toBe(false);
  });
});
