import { describe, expect, it, vi } from 'vitest';
import { resolveOrgId } from '../../../src/api/lib/resolve-org.js';

/** Create a minimal Hono context mock. */
function mockContext(opts: {
  session?: { activeOrganizationId?: string | null };
  userId?: string;
  headerOrgId?: string;
  memberships?: Array<{ organizationId: string }>;
}) {
  const memberships = opts.memberships ?? [];

  const selectResult = {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockImplementation(() => {
        // Check if this is a single-member lookup (has and() wrapper with two conditions)
        // The `limit(1)` call distinguishes the header validation path
        return {
          limit: vi.fn().mockImplementation((n: number) => {
            if (n === 1) {
              // Header validation path — check if the orgId is in memberships
              if (opts.headerOrgId) {
                const match = memberships.filter(m => m.organizationId === opts.headerOrgId);
                return Promise.resolve(match.length > 0 ? [match[0]] : []);
              }
              return Promise.resolve(memberships.slice(0, 1));
            }
            return Promise.resolve(memberships.slice(0, n));
          }),
        };
      }),
    }),
  };

  const db = {
    select: vi.fn().mockReturnValue(selectResult),
  };

  return {
    get: vi.fn().mockImplementation((key: string) => {
      if (key === 'session') return opts.session ?? null;
      if (key === 'user') return opts.userId ? { id: opts.userId } : null;
      if (key === 'db') return db;
      return null;
    }),
    req: {
      header: vi.fn().mockImplementation((name: string) => {
        if (name === 'X-Org-Id') return opts.headerOrgId;
        return undefined;
      }),
    },
  } as any;
}

describe('resolveOrgId', () => {
  it('returns activeOrganizationId from session when present', async () => {
    const c = mockContext({
      session: { activeOrganizationId: 'org-session' },
      userId: 'user-1',
    });
    expect(await resolveOrgId(c)).toBe('org-session');
  });

  it('returns null when no user', async () => {
    const c = mockContext({});
    expect(await resolveOrgId(c)).toBeNull();
  });

  it('returns org from X-Org-Id header when user is a member', async () => {
    const c = mockContext({
      userId: 'user-1',
      headerOrgId: 'org-header',
      memberships: [{ organizationId: 'org-header' }, { organizationId: 'org-other' }],
    });
    expect(await resolveOrgId(c)).toBe('org-header');
  });

  it('returns null when X-Org-Id header specifies org user is not a member of', async () => {
    const c = mockContext({
      userId: 'user-1',
      headerOrgId: 'org-not-member',
      memberships: [{ organizationId: 'org-a' }],
    });
    expect(await resolveOrgId(c)).toBeNull();
  });

  it('falls back to single org when no header and one membership', async () => {
    const c = mockContext({
      userId: 'user-1',
      memberships: [{ organizationId: 'org-single' }],
    });
    expect(await resolveOrgId(c)).toBe('org-single');
  });

  it('returns null when no header and multiple memberships (ambiguous)', async () => {
    const c = mockContext({
      userId: 'user-1',
      memberships: [{ organizationId: 'org-a' }, { organizationId: 'org-b' }],
    });
    expect(await resolveOrgId(c)).toBeNull();
  });

  it('returns null when no memberships at all', async () => {
    const c = mockContext({
      userId: 'user-1',
      memberships: [],
    });
    expect(await resolveOrgId(c)).toBeNull();
  });
});
