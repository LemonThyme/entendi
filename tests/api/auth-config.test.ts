import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockBetterAuth, mockSendEmail, mockOrganization, mockDbSelect, mockDbInsert, mockDbUpdate } = vi.hoisted(() => {
  const mockBetterAuth = vi.fn().mockReturnValue({
    api: { getSession: vi.fn(), createApiKey: vi.fn() },
    handler: vi.fn(),
  });
  const mockSendEmail = vi.fn().mockResolvedValue({ id: 'test-email-id' });
  const mockOrganization = vi.fn((opts: any) => ({ id: 'organization', _opts: opts }));
  const mockDbSelect = vi.fn();
  const mockDbInsert = vi.fn();
  const mockDbUpdate = vi.fn();
  return { mockBetterAuth, mockSendEmail, mockOrganization, mockDbSelect, mockDbInsert, mockDbUpdate };
});

vi.mock('better-auth', () => ({
  betterAuth: mockBetterAuth,
}));

vi.mock('better-auth/adapters/drizzle', () => ({
  drizzleAdapter: vi.fn(() => ({})),
}));

vi.mock('better-auth/plugins', () => ({
  admin: vi.fn(() => ({ id: 'admin' })),
  organization: mockOrganization,
  apiKey: vi.fn(() => ({ id: 'api-key' })),
  bearer: vi.fn(() => ({ id: 'bearer' })),
}));

vi.mock('../../src/api/lib/email.js', () => ({
  sendEmail: mockSendEmail,
  EmailTemplate: { OrgInvite: 'org_invite' },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...args: any[]) => args),
  and: vi.fn((...args: any[]) => args),
}));

vi.mock('../../src/api/db/schema.js', () => ({
  invitation: { id: 'invitation_id', email: 'invitation_email', status: 'invitation_status', organizationId: 'invitation_org_id', role: 'invitation_role' },
  member: { id: 'member_id', userId: 'member_user_id', organizationId: 'member_org_id', role: 'member_role' },
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

  it('configures databaseHooks to auto-accept pending invitations on sign-up', async () => {
    // Set up mock DB to return a pending invitation
    const mockWhere = vi.fn().mockResolvedValue([
      { id: 'inv-1', email: 'alice@example.com', organizationId: 'org-1', role: 'member', status: 'pending' },
    ]);
    const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
    const mockSelectResult = { from: mockFrom };
    mockDbSelect.mockReturnValue(mockSelectResult);

    const mockInsertValues = vi.fn().mockResolvedValue([]);
    mockDbInsert.mockReturnValue({ values: mockInsertValues });

    const mockUpdateSet = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) });
    mockDbUpdate.mockReturnValue({ set: mockUpdateSet });

    const mockDb = {
      select: mockDbSelect,
      insert: mockDbInsert,
      update: mockDbUpdate,
    } as any;

    createAuth(mockDb, { secret: 'test-secret', baseURL: 'http://localhost:3456' });

    const config = mockBetterAuth.mock.calls[0][0];
    expect(config.databaseHooks).toBeDefined();
    expect(config.databaseHooks.user.create.after).toBeDefined();

    // Simulate user creation
    await config.databaseHooks.user.create.after(
      { id: 'user-1', email: 'alice@example.com', name: 'Alice' },
      null,
    );

    // Verify it queried for pending invitations
    expect(mockDbSelect).toHaveBeenCalled();

    // Verify it created a member entry
    expect(mockDbInsert).toHaveBeenCalled();

    // Verify it updated the invitation status
    expect(mockDbUpdate).toHaveBeenCalled();
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
