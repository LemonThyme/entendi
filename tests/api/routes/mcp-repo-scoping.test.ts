import { describe, expect, it } from 'vitest';
import { z } from 'zod';

describe('observe repoUrl probe scoping', () => {
  // Validate the schema accepts repoUrl
  const observeSchema = z.object({
    concepts: z.array(z.object({
      id: z.string().min(1).max(200),
      source: z.enum(['package', 'ast', 'llm']),
    })).min(1).max(50),
    triggerContext: z.string().max(1000).default(''),
    primaryConceptId: z.string().max(200).optional(),
    repoUrl: z.string().url().max(500).optional(),
  });

  it('accepts observe input without repoUrl (backward compatible)', () => {
    const result = observeSchema.safeParse({
      concepts: [{ id: 'redis', source: 'llm' }],
      triggerContext: 'testing',
    });
    expect(result.success).toBe(true);
  });

  it('accepts observe input with valid repoUrl', () => {
    const result = observeSchema.safeParse({
      concepts: [{ id: 'redis', source: 'llm' }],
      triggerContext: 'testing',
      repoUrl: 'https://github.com/LemonThyme/entendi',
    });
    expect(result.success).toBe(true);
  });

  it('rejects observe input with invalid repoUrl', () => {
    const result = observeSchema.safeParse({
      concepts: [{ id: 'redis', source: 'llm' }],
      triggerContext: 'testing',
      repoUrl: 'not-a-url',
    });
    expect(result.success).toBe(false);
  });

  it('parses GitHub URL correctly', () => {
    const urls = [
      { url: 'https://github.com/LemonThyme/entendi', owner: 'LemonThyme', repo: 'entendi' },
      { url: 'https://github.com/org/repo-name', owner: 'org', repo: 'repo-name' },
      { url: 'https://github.com/user/repo.git', owner: 'user', repo: 'repo' },
    ];
    for (const { url, owner, repo } of urls) {
      const match = url.match(/github\.com\/([^/]+)\/([^/]+)/);
      expect(match).not.toBeNull();
      expect(match![1]).toBe(owner);
      expect(match![2].replace(/\.git$/, '')).toBe(repo);
    }
  });

  it('does not match non-GitHub URLs', () => {
    const match = 'https://gitlab.com/org/repo'.match(/github\.com\/([^/]+)\/([^/]+)/);
    expect(match).toBeNull();
  });
});
