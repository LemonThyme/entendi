import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { mockBetterAuth } = vi.hoisted(() => {
  const mockBetterAuth = vi.fn().mockReturnValue({
    api: { getSession: vi.fn(), createApiKey: vi.fn() },
    handler: vi.fn(),
  });
  return { mockBetterAuth };
});

vi.mock('better-auth', () => ({
  betterAuth: mockBetterAuth,
}));

vi.mock('better-auth/adapters/drizzle', () => ({
  drizzleAdapter: vi.fn(() => ({})),
}));

vi.mock('better-auth/plugins', () => ({
  organization: vi.fn(() => ({ id: 'organization' })),
  apiKey: vi.fn(() => ({ id: 'api-key' })),
  bearer: vi.fn(() => ({ id: 'bearer' })),
}));

import { createAuth } from '../../src/api/lib/auth.js';

describe('auth config', () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    mockBetterAuth.mockClear();
    savedEnv.GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID;
    savedEnv.GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;
    savedEnv.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
    savedEnv.GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
  });

  afterEach(() => {
    for (const [key, val] of Object.entries(savedEnv)) {
      if (val === undefined) delete process.env[key];
      else process.env[key] = val;
    }
  });

  it('creates auth with social providers when env vars set', () => {
    process.env.GITHUB_CLIENT_ID = 'test-gh-id';
    process.env.GITHUB_CLIENT_SECRET = 'test-gh-secret';
    process.env.GOOGLE_CLIENT_ID = 'test-google-id';
    process.env.GOOGLE_CLIENT_SECRET = 'test-google-secret';
    const auth = createAuth({} as any, { secret: 'test-secret', baseURL: 'http://localhost:3456' });
    expect(auth).toBeDefined();
    expect(auth.api).toBeDefined();

    const config = mockBetterAuth.mock.calls[0][0];
    expect(config.socialProviders).toBeDefined();
    expect(config.socialProviders.github).toEqual({
      clientId: 'test-gh-id',
      clientSecret: 'test-gh-secret',
    });
    expect(config.socialProviders.google).toEqual({
      clientId: 'test-google-id',
      clientSecret: 'test-google-secret',
    });
  });

  it('creates auth without social providers when env vars missing', () => {
    delete process.env.GITHUB_CLIENT_ID;
    delete process.env.GITHUB_CLIENT_SECRET;
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    const auth = createAuth({} as any, { secret: 'test-secret', baseURL: 'http://localhost:3456' });
    expect(auth).toBeDefined();
    expect(auth.api).toBeDefined();

    const config = mockBetterAuth.mock.calls[0][0];
    expect(config.socialProviders).toBeUndefined();
  });

  it('includes only github when only github env vars are set', () => {
    process.env.GITHUB_CLIENT_ID = 'gh-id';
    process.env.GITHUB_CLIENT_SECRET = 'gh-secret';
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    createAuth({} as any, { secret: 'test-secret', baseURL: 'http://localhost:3456' });

    const config = mockBetterAuth.mock.calls[0][0];
    expect(config.socialProviders).toBeDefined();
    expect(config.socialProviders.github).toBeDefined();
    expect(config.socialProviders.google).toBeUndefined();
  });
});
