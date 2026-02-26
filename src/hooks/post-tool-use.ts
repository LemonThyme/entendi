import { readStdin, log, type HookInput } from './shared.js';
import {
  detectPackageInstall,
  parsePackageFromCommand,
  extractConceptsFromPackage,
} from '../core/concept-extraction.js';

export interface PostToolUseOutput {
  hookSpecificOutput?: {
    additionalContext?: string;
  };
}

interface PostToolUseOptions {
  skipLLM?: boolean;
}

export async function handlePostToolUse(
  input: HookInput,
  options: PostToolUseOptions = {},
): Promise<PostToolUseOutput | null> {
  const toolName = input.tool_name as string;
  const conceptList: string[] = [];

  // 1. Package install detection (Bash tool)
  if (toolName === 'Bash') {
    const command = (input.tool_input as { command?: string })?.command;
    if (command && detectPackageInstall(command)) {
      const packages = parsePackageFromCommand(command);
      const packageConcepts = packages.flatMap((pkg) => extractConceptsFromPackage(pkg));
      for (const c of packageConcepts) {
        if (!conceptList.includes(c.name)) conceptList.push(c.name);
      }
      // Also add the raw package names as concepts (for packages not in the lookup)
      for (const pkg of packages) {
        const normalized = pkg.toLowerCase().replace(/\//g, '-');
        if (!conceptList.includes(normalized)) conceptList.push(normalized);
      }
    }
  }

  // 2. File operations — extract concepts from file paths and content patterns
  if (toolName === 'Write' || toolName === 'Edit' || toolName === 'Read') {
    const filePath = (input.tool_input as { file_path?: string })?.file_path || '';
    const pathConcepts = extractConceptsFromPath(filePath);
    for (const c of pathConcepts) {
      if (!conceptList.includes(c)) conceptList.push(c);
    }

    // For Write/Edit, also look at the content being written
    if (toolName === 'Write' || toolName === 'Edit') {
      const content = (input.tool_input as { content?: string; new_string?: string })?.content
        || (input.tool_input as { new_string?: string })?.new_string || '';
      const contentConcepts = extractConceptsFromCode(content);
      for (const c of contentConcepts) {
        if (!conceptList.includes(c)) conceptList.push(c);
      }
    }
  }

  if (conceptList.length === 0) return null;

  // 3. Return additionalContext instructing Claude to call entendi_observe
  const conceptListStr = conceptList.slice(0, 10).join(', '); // cap at 10
  const trigger = toolName === 'Bash'
    ? (input.tool_input as { command?: string })?.command || toolName
    : toolName;

  return {
    hookSpecificOutput: {
      additionalContext:
        `[Entendi] Concepts detected from tool use: ${conceptListStr}. Trigger: ${trigger}. ` +
        `Use the entendi_observe tool to check if a comprehension probe is appropriate. ` +
        `Pass concepts as [{id: "concept-id", source: "ast"}] for each concept. ` +
        `Complete the user's request fully first. If a probe is warranted, weave it ` +
        `naturally into your response — be conversational, not examiner-like.`,
    },
  };
}

/**
 * Extract concept hints from a file path.
 * e.g., "src/api/routes/mcp.ts" → ["hono", "mcp"]
 *       "src/api/db/schema.ts" → ["drizzle-orm", "database-schema"]
 */
function extractConceptsFromPath(filePath: string): string[] {
  const concepts: string[] = [];
  const lower = filePath.toLowerCase();

  const pathPatterns: Array<[RegExp, string[]]> = [
    [/drizzle|schema\.ts|migrate\.ts/, ['drizzle-orm']],
    [/hono|routes\//, ['hono']],
    [/auth\.ts|better-auth|middleware\/auth/, ['better-auth']],
    [/mcp/, ['mcp-protocol']],
    [/\.test\.ts|\.spec\.ts|vitest/, ['testing']],
    [/hooks\//, ['claude-code-hooks']],
    [/esbuild|build/, ['esbuild']],
    [/dockerfile|docker-compose/, ['docker']],
    [/\.sql$/, ['sql']],
    [/neon|serverless/, ['neon-postgres']],
    [/webpack|vite\.config/, ['bundler']],
    [/tailwind/, ['tailwind-css']],
    [/prisma/, ['prisma']],
    [/graphql/, ['graphql']],
    [/redis/, ['redis']],
  ];

  for (const [pattern, ids] of pathPatterns) {
    if (pattern.test(lower)) {
      for (const id of ids) {
        if (!concepts.includes(id)) concepts.push(id);
      }
    }
  }

  return concepts;
}

/**
 * Extract concept hints from code content.
 * Looks for import statements, API patterns, and library-specific idioms.
 */
function extractConceptsFromCode(content: string): string[] {
  if (!content || content.length < 20) return [];
  const concepts: string[] = [];

  const codePatterns: Array<[RegExp, string[]]> = [
    [/from\s+['"]drizzle-orm/, ['drizzle-orm']],
    [/from\s+['"]hono/, ['hono']],
    [/from\s+['"]better-auth/, ['better-auth']],
    [/from\s+['"]@modelcontextprotocol/, ['mcp-protocol']],
    [/from\s+['"]@neondatabase/, ['neon-postgres']],
    [/from\s+['"]zod/, ['zod']],
    [/from\s+['"]vitest/, ['vitest']],
    [/pgTable|drizzle\(/, ['drizzle-orm']],
    [/new Hono|app\.use|app\.get|app\.post|app\.route/, ['hono']],
    [/betterAuth|drizzleAdapter|apiKey\(/, ['better-auth']],
    [/McpServer|StdioServerTransport/, ['mcp-protocol']],
    [/grmUpdate|bayesianUpdate|pMastery|fisherInformation/, ['bayesian-irt', 'grm']],
    [/fsrsStability|retrievability|decayPrior/, ['fsrs', 'spaced-repetition']],
    [/async\s+function|await\s+/, ['async-await']],
    [/z\.object|z\.string|z\.array/, ['zod']],
    [/\.execute\(sql`|\.select\(\)\.from\(/, ['sql']],
    [/recursive\s+cte|WITH\s+RECURSIVE/i, ['recursive-cte']],
    [/cors\(|CORS/, ['cors']],
    [/Bearer|x-api-key|Authorization/, ['api-authentication']],
    [/onConflictDoUpdate|onConflictDoNothing/, ['upsert-pattern']],
  ];

  for (const [pattern, ids] of codePatterns) {
    if (pattern.test(content)) {
      for (const id of ids) {
        if (!concepts.includes(id)) concepts.push(id);
      }
    }
  }

  return concepts;
}

async function main() {
  log('hook:post-tool-use', 'started');
  const raw = await readStdin();
  if (!raw || !raw.trim()) {
    log('hook:post-tool-use', 'empty stdin, exiting');
    process.exit(0);
  }
  log('hook:post-tool-use', 'stdin received', { length: raw.length });
  const input: HookInput = JSON.parse(raw);
  log('hook:post-tool-use', 'parsed input', { tool: input.tool_name, event: input.hook_event_name });
  const result = await handlePostToolUse(input);

  if (result) {
    const output = JSON.stringify(result);
    log('hook:post-tool-use', 'output', { length: output.length, preview: output.slice(0, 300) });
    process.stdout.write(output);
  } else {
    log('hook:post-tool-use', 'no output (null result)');
  }

  process.exit(0);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  main().catch((err) => {
    log('hook:post-tool-use', 'fatal error', { error: String(err), stack: (err as Error)?.stack });
    process.exit(0);
  });
}
