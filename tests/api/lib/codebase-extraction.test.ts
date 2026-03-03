import { describe, expect, it } from 'vitest';
import { selectFilesForTier, extractCodebaseConcepts } from '../../../src/api/lib/codebase-extraction.js';
import type { ExtractedConcept } from '../../../src/api/lib/codebase-extraction.js';

const sampleTree = [
  { path: 'README.md', type: 'blob' },
  { path: 'CLAUDE.md', type: 'blob' },
  { path: 'package.json', type: 'blob' },
  { path: '.gitignore', type: 'blob' },
  { path: 'tsconfig.json', type: 'blob' },
  { path: 'src', type: 'tree' },
  { path: 'src/index.ts', type: 'blob' },
  { path: 'src/main.ts', type: 'blob' },
  { path: 'src/app.ts', type: 'blob' },
  { path: 'src/utils.ts', type: 'blob' },
  { path: 'src/db/schema.ts', type: 'blob' },
  { path: 'src/db/connection.ts', type: 'blob' },
  { path: 'src/routes/users.ts', type: 'blob' },
  { path: 'src/routes/posts.ts', type: 'blob' },
  { path: 'src/config.ts', type: 'blob' },
  { path: 'src/deep/nested/module.ts', type: 'blob' },
  { path: 'tests/index.test.ts', type: 'blob' },
];

describe('selectFilesForTier', () => {
  describe('Tier 1 — root config files', () => {
    it('selects README, CLAUDE.md, and package.json', () => {
      const result = selectFilesForTier(sampleTree, 1);
      expect(result).toContain('README.md');
      expect(result).toContain('CLAUDE.md');
      expect(result).toContain('package.json');
    });

    it('does NOT select non-root files', () => {
      const result = selectFilesForTier(sampleTree, 1);
      expect(result).not.toContain('src/index.ts');
      expect(result).not.toContain('src/db/schema.ts');
      expect(result).not.toContain('.gitignore');
    });

    it('does NOT select directories', () => {
      const result = selectFilesForTier(sampleTree, 1);
      expect(result).not.toContain('src');
    });

    it('handles Cargo.toml for Rust projects', () => {
      const rustTree = [
        { path: 'Cargo.toml', type: 'blob' },
        { path: 'src/main.rs', type: 'blob' },
      ];
      const result = selectFilesForTier(rustTree, 1);
      expect(result).toContain('Cargo.toml');
    });

    it('handles pyproject.toml for Python projects', () => {
      const pyTree = [
        { path: 'pyproject.toml', type: 'blob' },
        { path: 'src/main.py', type: 'blob' },
      ];
      const result = selectFilesForTier(pyTree, 1);
      expect(result).toContain('pyproject.toml');
    });

    it('handles go.mod for Go projects', () => {
      const goTree = [
        { path: 'go.mod', type: 'blob' },
        { path: 'main.go', type: 'blob' },
      ];
      const result = selectFilesForTier(goTree, 1);
      expect(result).toContain('go.mod');
    });

    it('matches README with various extensions', () => {
      const tree = [
        { path: 'README', type: 'blob' },
        { path: 'README.md', type: 'blob' },
        { path: 'README.rst', type: 'blob' },
      ];
      const result = selectFilesForTier(tree, 1);
      expect(result).toHaveLength(3);
    });

    it('ignores README files in subdirectories', () => {
      const tree = [
        { path: 'docs/README.md', type: 'blob' },
        { path: 'README.md', type: 'blob' },
      ];
      const result = selectFilesForTier(tree, 1);
      expect(result).toEqual(['README.md']);
    });
  });

  describe('Tier 2 — entry points, schemas, routes, configs', () => {
    it('includes Tier 1 files', () => {
      const result = selectFilesForTier(sampleTree, 2);
      expect(result).toContain('README.md');
      expect(result).toContain('package.json');
    });

    it('includes src/index.*, src/main.*, src/app.*', () => {
      const result = selectFilesForTier(sampleTree, 2);
      expect(result).toContain('src/index.ts');
      expect(result).toContain('src/main.ts');
      expect(result).toContain('src/app.ts');
    });

    it('includes schema files at any depth', () => {
      const result = selectFilesForTier(sampleTree, 2);
      expect(result).toContain('src/db/schema.ts');
    });

    it('includes route files', () => {
      const result = selectFilesForTier(sampleTree, 2);
      expect(result).toContain('src/routes/users.ts');
      expect(result).toContain('src/routes/posts.ts');
    });

    it('includes config files', () => {
      const result = selectFilesForTier(sampleTree, 2);
      expect(result).toContain('src/config.ts');
    });

    it('does NOT include arbitrary files', () => {
      const result = selectFilesForTier(sampleTree, 2);
      expect(result).not.toContain('src/utils.ts');
      expect(result).not.toContain('src/deep/nested/module.ts');
      expect(result).not.toContain('tests/index.test.ts');
    });
  });

  describe('Tier 3 — deep dive paths', () => {
    it('includes Tier 2 files + specified deep dive paths', () => {
      const result = selectFilesForTier(sampleTree, 3, ['src/deep/nested/module.ts']);
      expect(result).toContain('README.md');
      expect(result).toContain('src/index.ts');
      expect(result).toContain('src/deep/nested/module.ts');
    });

    it('ignores deep dive paths that are not in the tree', () => {
      const result = selectFilesForTier(sampleTree, 3, ['nonexistent/file.ts']);
      expect(result).not.toContain('nonexistent/file.ts');
    });

    it('works without deepDivePaths argument', () => {
      const result = selectFilesForTier(sampleTree, 3);
      // Should be same as tier 2
      const tier2 = selectFilesForTier(sampleTree, 2);
      expect(result).toEqual(tier2);
    });

    it('deduplicates paths already included by tier 2', () => {
      const result = selectFilesForTier(sampleTree, 3, ['src/index.ts']);
      const indexCount = result.filter((p) => p === 'src/index.ts').length;
      expect(indexCount).toBe(1);
    });
  });

  describe('edge cases', () => {
    it('returns empty array for empty tree', () => {
      expect(selectFilesForTier([], 1)).toEqual([]);
      expect(selectFilesForTier([], 2)).toEqual([]);
      expect(selectFilesForTier([], 3)).toEqual([]);
    });

    it('returns sorted results', () => {
      const result = selectFilesForTier(sampleTree, 2);
      const sorted = [...result].sort();
      expect(result).toEqual(sorted);
    });

    it('handles tree with only directories', () => {
      const dirTree = [
        { path: 'src', type: 'tree' },
        { path: 'docs', type: 'tree' },
      ];
      expect(selectFilesForTier(dirTree, 1)).toEqual([]);
    });
  });
});

describe('extractCodebaseConcepts', () => {
  it('extracts concepts from package.json dependencies', async () => {
    const mockGithub = {
      getTree: async () => ({
        sha: 'abc',
        url: '',
        tree: [{ path: 'package.json', type: 'blob', sha: '', mode: '', url: '' }],
        truncated: false,
      }),
      getFileContent: async () => JSON.stringify({
        dependencies: { hono: '4.0.0', drizzle: '1.0.0' },
      }),
    } as any;

    const result = await extractCodebaseConcepts(mockGithub, 'owner', 'repo', 1);
    expect(result.length).toBeGreaterThanOrEqual(2);
    expect(result.some((c: ExtractedConcept) => c.conceptName === 'hono')).toBe(true);
  });

  it('extracts architecture concept from README', async () => {
    const mockGithub = {
      getTree: async () => ({
        sha: 'abc',
        url: '',
        tree: [{ path: 'README.md', type: 'blob', sha: '', mode: '', url: '' }],
        truncated: false,
      }),
      getFileContent: async () => '# My Project\n\nSome description.',
    } as any;

    const result = await extractCodebaseConcepts(mockGithub, 'owner', 'myrepo', 1);
    expect(result.some((c: ExtractedConcept) => c.conceptName === 'myrepo-architecture')).toBe(true);
    expect(result.find((c: ExtractedConcept) => c.conceptName === 'myrepo-architecture')?.importance).toBe('core');
  });

  it('extracts data model concept from schema files', async () => {
    const mockGithub = {
      getTree: async () => ({
        sha: 'abc',
        url: '',
        tree: [
          { path: 'package.json', type: 'blob', sha: '', mode: '', url: '' },
          { path: 'src/db/schema.ts', type: 'blob', sha: '', mode: '', url: '' },
        ],
        truncated: false,
      }),
      getFileContent: async (owner: string, repo: string, path: string) => {
        if (path === 'package.json') return '{}';
        return 'export const users = pgTable("users", {});';
      },
    } as any;

    const result = await extractCodebaseConcepts(mockGithub, 'owner', 'repo', 2);
    expect(result.some((c: ExtractedConcept) => c.conceptName === 'repo-data-model')).toBe(true);
  });

  it('extracts route concepts from route files', async () => {
    const mockGithub = {
      getTree: async () => ({
        sha: 'abc',
        url: '',
        tree: [
          { path: 'src/routes/users.ts', type: 'blob', sha: '', mode: '', url: '' },
        ],
        truncated: false,
      }),
      getFileContent: async () => 'export const userRoutes = new Hono();',
    } as any;

    const result = await extractCodebaseConcepts(mockGithub, 'owner', 'repo', 2);
    expect(result.some((c: ExtractedConcept) => c.conceptName === 'users-api')).toBe(true);
  });

  it('handles file fetch errors gracefully', async () => {
    const mockGithub = {
      getTree: async () => ({
        sha: 'abc',
        url: '',
        tree: [
          { path: 'README.md', type: 'blob', sha: '', mode: '', url: '' },
          { path: 'package.json', type: 'blob', sha: '', mode: '', url: '' },
        ],
        truncated: false,
      }),
      getFileContent: async (owner: string, repo: string, path: string) => {
        if (path === 'README.md') throw new Error('404');
        return '{}';
      },
    } as any;

    const result = await extractCodebaseConcepts(mockGithub, 'owner', 'repo', 1);
    // Should still return results from successfully fetched files
    expect(result).toBeDefined();
  });

  it('returns empty array for empty repo', async () => {
    const mockGithub = {
      getTree: async () => ({
        sha: 'abc',
        url: '',
        tree: [],
        truncated: false,
      }),
    } as any;

    const result = await extractCodebaseConcepts(mockGithub, 'owner', 'repo', 1);
    expect(result).toEqual([]);
  });
});
