import { readStdin, getDataDir, type HookInput } from './shared.js';
import {
  detectPackageInstall,
  parsePackageFromCommand,
  extractConceptsFromPackage,
} from '../core/concept-extraction.js';
import { initParser, extractConceptsFromSource, type SupportedLanguage } from '../core/ast-extraction.js';

export interface PostToolUseOutput {
  hookSpecificOutput?: {
    additionalContext?: string;
  };
}

interface PostToolUseOptions {
  skipLLM?: boolean;
  dataDir?: string;
  userId?: string;
}

export async function handlePostToolUse(
  input: HookInput,
  options: PostToolUseOptions = {},
): Promise<PostToolUseOutput | null> {
  // 1. Only handle Bash tool
  if (input.tool_name !== 'Bash') return null;

  // 2. Extract command
  const toolInput = input.tool_input as { command?: string } | undefined;
  const command = toolInput?.command;
  if (!command) return null;

  // 3. Must be a package install command
  if (!detectPackageInstall(command)) return null;

  // 4. Extract package names
  const packages = parsePackageFromCommand(command);
  if (packages.length === 0) return null;

  // 5. Map packages to concepts via lookup table
  const packageConcepts = packages.flatMap((pkg) => extractConceptsFromPackage(pkg));

  // 6. AST extraction from tool output (best-effort)
  let astConcepts: Array<{ name: string; domain: string }> = [];
  try {
    const toolOutput = getToolOutput(input);
    if (toolOutput && looksLikeSourceCode(toolOutput)) {
      await initParser();
      const language = detectLanguage(toolOutput);
      const rawAstConcepts = await extractConceptsFromSource(toolOutput, language);
      astConcepts = rawAstConcepts.map((c) => ({
        name: c.name,
        domain: 'programming-languages',
      }));
    }
  } catch {
    // AST extraction is best-effort; don't fail the hook
  }

  // 7. Combine and deduplicate
  const allNames = new Set<string>();
  const conceptList: string[] = [];
  for (const c of [...packageConcepts, ...astConcepts]) {
    if (!allNames.has(c.name)) {
      allNames.add(c.name);
      conceptList.push(c.name);
    }
  }
  if (conceptList.length === 0) return null;

  // 8. Return additionalContext instructing Claude to call entendi_observe
  const conceptListStr = conceptList.join(', ');
  return {
    hookSpecificOutput: {
      additionalContext:
        `[Entendi] Concepts detected from tool use: ${conceptListStr}. Trigger: ${command}. ` +
        `Use the entendi_observe tool to check if a comprehension probe is appropriate. ` +
        `Complete the user's request fully first. If a probe is warranted, weave it ` +
        `naturally into your response — be conversational, not examiner-like.`,
    },
  };
}

/**
 * Extract tool output as a string from the hook input.
 */
function getToolOutput(input: HookInput): string | null {
  if (typeof input.tool_output === 'string') return input.tool_output;
  const response = input.tool_response as { stdout?: string } | undefined;
  if (response && typeof response.stdout === 'string') return response.stdout;
  return null;
}

/**
 * Heuristic check: does the output look like source code?
 */
function looksLikeSourceCode(output: string): boolean {
  const lines = output.split('\n');
  if (lines.length > 5) return true;
  const codePatterns = /\b(function|class|import|export|async|await|def|const|let|var|interface|type)\b/;
  return codePatterns.test(output);
}

/**
 * Detect language from source code content.
 */
function detectLanguage(source: string): SupportedLanguage {
  if (/\bdef\s+\w+\s*\(/.test(source) || (/\bimport\s+\w+/.test(source) && /:\s*$/m.test(source))) {
    return 'python';
  }
  if (/\b(interface|type)\s+\w+/.test(source) || /:\s*(string|number|boolean|void)\b/.test(source)) {
    return 'typescript';
  }
  return 'typescript';
}

async function main() {
  const raw = await readStdin();
  const input: HookInput = JSON.parse(raw);
  const result = await handlePostToolUse(input);

  if (result) {
    process.stdout.write(JSON.stringify(result));
  }

  process.exit(0);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  main().catch((err) => {
    process.stderr.write(`[Entendi] Hook error: ${String(err)}\n`);
    process.exit(0);
  });
}
