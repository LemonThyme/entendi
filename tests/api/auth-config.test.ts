import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { mockBetterAuth, mockSendEmail, mockOrganization } = vi.hoisted(() => {
  const mockBetterAuth = vi.fn().mockReturnValue({
    api: { getSession: vi.fn(), createApiKey: vi.fn() },
    handler: vi.fn(),
  });
  const mockSendEmail = vi.fn().mockResolvedValue({ id: 'test-email-id' });
  const mockOrganization = vi.fn((opts: any) => ({ id: 'organization', _opts: opts }));
  return { mockBetterAuth, mockSendEmail, mockOrganization };
});

vi.mock('better-auth', () => ({
  betterAuth: mockBetterAuth,
}));

vi.mock('better-auth/adapters/drizzle', () => ({
  drizzleAdapter: vi.fn(() => ({})),
}));

vi.mock('better-auth/plugins', () => ({
  organization: mockOrganization,
  apiKey: vi.fn(() => ({ id: 'api-key' })),
  bearer: vi.fn(() => ({ id: 'bearer' })),
}));

vi.mock('../../src/api/lib/email.js', () => ({
  sendEmail: mockSendEmail,
  EmailTemplate: { OrgInvite: 'org_invite' },
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

  it('configures sendInvitationEmail callback on organization plugin', async () => {
    createAuth({} as any, { secret: 'test-secret', baseURL: 'http://localhost:3456' });

    // organization() was called with options that include sendInvitationEmail
    const orgOpts = mockOrganization.mock.calls[0][0];
    expect(orgOpts.sendInvitationEmail).toBeDefined();
    expect(typeof orgOpts.sendInvitationEmail).toBe('function');

    // Call the callback and verify it sends email
    await orgOpts.sendInvitationEmail({
      id: 'inv-123',
      role: 'member',
      email: 'newuser@example.com',
      organization: { id: 'org-1', name: 'Test Org' },
      invitation: {},
      inviter: {},
    });

    expect(mockSendEmail).toHaveBeenCalledWith({
      to: 'newuser@example.com',
      template: 'org_invite',
      vars: {
        orgName: 'Test Org',
        inviteLink: expect.stringContaining('inv-123'),
      },
    });
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
