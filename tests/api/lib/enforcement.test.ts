import { describe, expect, it, vi } from 'vitest';
import { resolveEnforcementLevel } from '../../../src/api/lib/enforcement.js';

function mockDb(rows: Array<{ metadata: string | null }>) {
  return {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(rows),
        }),
      }),
    }),
  } as any;
}

describe('resolveEnforcementLevel', () => {
  it('returns "remind" as default when user has no org', async () => {
    const db = mockDb([]);
    const result = await resolveEnforcementLevel(db, 'user-123');
    expect(result).toBe('remind');
  });

  it('returns org-level enforcement from metadata', async () => {
    const db = mockDb([{ metadata: JSON.stringify({ enforcementLevel: 'enforce' }) }]);
    const result = await resolveEnforcementLevel(db, 'user-123');
    expect(result).toBe('enforce');
  });

  it('returns "remind" when org metadata has no enforcementLevel', async () => {
    const db = mockDb([{ metadata: JSON.stringify({ integritySettings: {} }) }]);
    const result = await resolveEnforcementLevel(db, 'user-123');
    expect(result).toBe('remind');
  });

  it('returns "off" when org sets enforcement to off', async () => {
    const db = mockDb([{ metadata: JSON.stringify({ enforcementLevel: 'off' }) }]);
    const result = await resolveEnforcementLevel(db, 'user-123');
    expect(result).toBe('off');
  });

  it('picks strictest level when user belongs to multiple orgs', async () => {
    const db = mockDb([
      { metadata: JSON.stringify({ enforcementLevel: 'remind' }) },
      { metadata: JSON.stringify({ enforcementLevel: 'enforce' }) },
    ]);
    const result = await resolveEnforcementLevel(db, 'user-123');
    expect(result).toBe('enforce');
  });

  it('ignores malformed metadata', async () => {
    const db = mockDb([{ metadata: 'not-json' }]);
    const result = await resolveEnforcementLevel(db, 'user-123');
    expect(result).toBe('remind');
  });

  it('handles null metadata gracefully', async () => {
    const db = mockDb([{ metadata: null }]);
    const result = await resolveEnforcementLevel(db, 'user-123');
    expect(result).toBe('remind');
  });

  it('ignores invalid enforcement level values', async () => {
    const db = mockDb([{ metadata: JSON.stringify({ enforcementLevel: 'invalid' }) }]);
    const result = await resolveEnforcementLevel(db, 'user-123');
    expect(result).toBe('remind');
  });
});
