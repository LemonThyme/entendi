// src/api/lib/codebase-extraction.ts — File selection and concept extraction for codebases

import type { GitHubClient } from './github.js';

export interface ExtractedConcept {
  conceptName: string;
  importance: 'core' | 'supporting' | 'peripheral';
  learningObjective: string;
}

/** Root config files for Tier 1 extraction. */
const TIER_1_PATTERNS = [
  /^README(\..+)?$/i,
  /^CLAUDE\.md$/i,
  /^package\.json$/,
  /^Cargo\.toml$/,
  /^pyproject\.toml$/,
  /^go\.mod$/,
  /^Gemfile$/,
  /^composer\.json$/,
  /^pom\.xml$/,
  /^build\.gradle(\.kts)?$/,
];

/** Entry points, schemas, routes, and configs for Tier 2 extraction. */
const TIER_2_PATTERNS = [
  /^src\/index\.[^/]+$/,
  /^src\/main\.[^/]+$/,
  /^src\/app\.[^/]+$/,
  /^(.*\/)?schema\.[^/]+$/,
  /^(.*\/)?routes\/[^/]+$/,
  /^(.*\/)?config\.[^/]+$/,
];

function matchesTier1(path: string): boolean {
  const basename = path.split('/').pop() ?? '';
  return TIER_1_PATTERNS.some((p) => p.test(basename)) && !path.includes('/');
}

function matchesTier2(path: string): boolean {
  return TIER_2_PATTERNS.some((p) => p.test(path));
}

/**
 * Select files from a repository tree based on extraction tier.
 *
 * - Tier 1: Root config files (README, package.json, etc.)
 * - Tier 2: Tier 1 + entry points, schemas, routes, configs
 * - Tier 3: Tier 2 + user-specified deepDivePaths
 */
export function selectFilesForTier(
  tree: { path: string; type: string }[],
  tier: 1 | 2 | 3,
  deepDivePaths?: string[],
): string[] {
  const blobs = tree.filter((item) => item.type === 'blob');
  const selected = new Set<string>();

  // Tier 1: root config files
  for (const item of blobs) {
    if (matchesTier1(item.path)) {
      selected.add(item.path);
    }
  }

  // Tier 2: entry points, schemas, routes, configs
  if (tier >= 2) {
    for (const item of blobs) {
      if (matchesTier2(item.path)) {
        selected.add(item.path);
      }
    }
  }

  // Tier 3: specific deep-dive paths
  if (tier >= 3 && deepDivePaths) {
    const blobPaths = new Set(blobs.map((b) => b.path));
    for (const p of deepDivePaths) {
      if (blobPaths.has(p)) {
        selected.add(p);
      }
    }
  }

  return [...selected].sort();
}

/**
 * Extract concepts from a GitHub codebase.
 *
 * Gets the repo tree, selects files based on tier, and fetches their content.
 * Actual LLM extraction is stubbed — returns placeholder concepts derived from
 * file names until Cloudflare AI integration is added.
 */
export async function extractCodebaseConcepts(
  github: GitHubClient,
  owner: string,
  repo: string,
  tier: 1 | 2 | 3,
  deepDivePaths?: string[],
): Promise<ExtractedConcept[]> {
  const treeResponse = await github.getTree(owner, repo);
  const filePaths = selectFilesForTier(treeResponse.tree, tier, deepDivePaths);

  // Fetch content of selected files (in parallel, with concurrency cap)
  const fileContents: { path: string; content: string }[] = [];
  const batchSize = 5;
  for (let i = 0; i < filePaths.length; i += batchSize) {
    const batch = filePaths.slice(i, i + batchSize);
    const results = await Promise.allSettled(
      batch.map(async (path) => ({
        path,
        content: await github.getFileContent(owner, repo, path),
      })),
    );
    for (const r of results) {
      if (r.status === 'fulfilled') {
        fileContents.push(r.value);
      }
    }
  }

  // Stub: derive placeholder concepts from file names and content structure
  // Real implementation will use Cloudflare AI / LLM to extract concepts
  const concepts: ExtractedConcept[] = [];

  for (const file of fileContents) {
    const basename = file.path.split('/').pop() ?? file.path;
    const ext = basename.split('.').pop() ?? '';

    if (basename === 'package.json') {
      try {
        const pkg = JSON.parse(file.content);
        if (pkg.dependencies) {
          for (const dep of Object.keys(pkg.dependencies).slice(0, 5)) {
            concepts.push({
              conceptName: dep,
              importance: 'supporting',
              learningObjective: `Understand the role of ${dep} in this project`,
            });
          }
        }
      } catch { /* malformed JSON */ }
    } else if (/^README/i.test(basename)) {
      concepts.push({
        conceptName: `${repo}-architecture`,
        importance: 'core',
        learningObjective: `Understand the high-level architecture of ${repo}`,
      });
    } else if (/schema/i.test(basename)) {
      concepts.push({
        conceptName: `${repo}-data-model`,
        importance: 'core',
        learningObjective: `Understand the data model and schema design`,
      });
    } else if (/routes/i.test(file.path)) {
      const routeName = basename.replace(/\.[^.]+$/, '');
      concepts.push({
        conceptName: `${routeName}-api`,
        importance: 'supporting',
        learningObjective: `Understand the ${routeName} API endpoints`,
      });
    } else if (['ts', 'js', 'py', 'rs', 'go'].includes(ext)) {
      concepts.push({
        conceptName: basename.replace(/\.[^.]+$/, ''),
        importance: 'peripheral',
        learningObjective: `Understand the purpose of ${basename}`,
      });
    }
  }

  return concepts;
}
