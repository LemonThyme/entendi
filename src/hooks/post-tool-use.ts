import { readStdin, getDataDir, getUserId, type HookInput } from './shared.js';
import {
  detectPackageInstall,
  parsePackageFromCommand,
  extractConceptsFromPackage,
} from '../core/concept-extraction.js';
import { initParser, extractConceptsFromSource, type SupportedLanguage } from '../core/ast-extraction.js';
import { KnowledgeGraph } from '../core/knowledge-graph.js';
import { StateManager } from '../core/state-manager.js';
import { shouldProbe, selectConceptToProbe } from '../core/probe-scheduler.js';
import type { ProbeCandidateInfo } from '../core/probe-scheduler.js';
import { generateProbe } from '../core/probe-engine.js';
import type { ConceptNode } from '../schemas/types.js';
import { DEFAULT_GRM_PARAMS } from '../schemas/types.js';

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
  const { skipLLM = false } = options;

  // 1. Check if tool_name is 'Bash'
  if (input.tool_name !== 'Bash') return null;

  // 2. Extract the command from tool_input
  const toolInput = input.tool_input as { command?: string } | undefined;
  const command = toolInput?.command;
  if (!command) return null;

  // 3. Check if the command is a package install
  if (!detectPackageInstall(command)) return null;

  // 4. Extract package names
  const packages = parsePackageFromCommand(command);
  if (packages.length === 0) return null;

  // 5. Map to concepts from packages
  const packageConcepts = packages.flatMap((pkg) => extractConceptsFromPackage(pkg));

  // 5b. AST extraction from tool output (best-effort)
  let astConcepts: Array<{ name: string; specificity: import('../schemas/types.js').ConceptSpecificity; confidence: number; extractionSignal: 'ast'; domain: string }> = [];
  try {
    const toolOutput = getToolOutput(input);
    if (toolOutput && looksLikeSourceCode(toolOutput)) {
      await initParser();
      const language = detectLanguage(toolOutput);
      const rawAstConcepts = await extractConceptsFromSource(toolOutput, language);
      // Add domain field for AST-detected concepts (all are programming language features)
      astConcepts = rawAstConcepts.map((c) => ({
        ...c,
        domain: 'programming-languages',
      }));
    }
  } catch {
    // AST extraction is best-effort; don't fail the hook
  }

  // 5c. Combine and deduplicate concepts from both signals
  const allConcepts = [...packageConcepts, ...astConcepts];
  if (allConcepts.length === 0) return null;

  // 6. Load state and ensure concepts exist in knowledge graph
  const dataDir = options.dataDir ?? getDataDir(input.cwd);
  const userId = options.userId ?? getUserId();
  const sm = new StateManager(dataDir, userId);
  const kg = sm.getKnowledgeGraph();

  // Deduplicate concepts by name
  const seenConcepts = new Set<string>();
  const uniqueConcepts = allConcepts.filter((c) => {
    if (seenConcepts.has(c.name)) return false;
    seenConcepts.add(c.name);
    return true;
  });

  // Ensure each concept exists in the knowledge graph
  for (const concept of uniqueConcepts) {
    if (!kg.getConcept(concept.name)) {
      const node: ConceptNode = {
        conceptId: concept.name,
        aliases: [],
        domain: concept.domain,
        specificity: concept.specificity,
        parentConcept: null,
        itemParams: { discrimination: 1.0, thresholds: [-1, 0, 1] },
        relationships: [],
        lifecycle: 'discovered',
        populationStats: { meanMastery: 0, assessmentCount: 0, failureRate: 0 },
      };
      kg.addConcept(node);
    }
  }

  // Build probe candidates from ALL unique concepts
  const now = Date.now();
  const candidates: ProbeCandidateInfo[] = uniqueConcepts.map((concept) => {
    const ucs = kg.getUserConceptState(userId, concept.name);
    const conceptNode = kg.getConcept(concept.name);
    const daysSinceAssessment = ucs.lastAssessed
      ? (now - new Date(ucs.lastAssessed).getTime()) / (1000 * 60 * 60 * 24)
      : 365; // Never assessed = treat as very stale
    return {
      conceptId: concept.name,
      mu: ucs.mastery.mu,
      sigma: ucs.mastery.sigma,
      stability: ucs.memory.stability,
      daysSinceAssessment,
      itemParams: conceptNode?.itemParams ?? DEFAULT_GRM_PARAMS,
    };
  });

  // Use selectConceptToProbe to pick the best concept
  const selectedConceptId = selectConceptToProbe(candidates);
  if (!selectedConceptId) {
    sm.save();
    return null;
  }

  // Classify novelty for the selected concept
  const novelty = kg.classifyNovelty(userId, selectedConceptId);

  // 7. Decide whether to probe — when skipLLM is true, force the probe
  const probeDecision = skipLLM ? true : shouldProbe(novelty);
  if (!probeDecision) {
    sm.save();
    return null;
  }

  // 8. Generate a probe question
  let question: string;
  let probeType: 'why' | 'transfer' | 'failure' | 'counterfactual' | 'dependency' | 'context_bound' = 'why';

  if (skipLLM) {
    // Fallback: use a default probe question
    question = `I noticed you're using ${selectedConceptId}. Can you explain why you chose it for this project?`;
  } else {
    const probe = await generateProbe({
      conceptName: selectedConceptId,
      triggerContext: command,
      targetDepth: 0,
      previousResponses: [],
    });
    question = probe.question;
    probeType = probe.probeType;
  }

  // 9. Store as pending probe
  const probeId = `probe_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  sm.setPendingProbe({
    probe: {
      probeId,
      conceptId: selectedConceptId,
      question,
      depth: 0,
      probeType,
    },
    triggeredAt: new Date().toISOString(),
    triggerContext: command,
    previousResponses: [],
  });
  sm.save();

  // 10. Return additionalContext telling Claude to ask the probe question
  return {
    hookSpecificOutput: {
      additionalContext: `[Entendi] Before continuing, please ask the user this comprehension check question naturally in conversation: "${question}"`,
    },
  };
}

/**
 * Extract tool output as a string from the hook input.
 * Handles both string tool_output and object tool_response with stdout.
 */
function getToolOutput(input: HookInput): string | null {
  if (typeof input.tool_output === 'string') return input.tool_output;
  const response = input.tool_response as { stdout?: string } | undefined;
  if (response && typeof response.stdout === 'string') return response.stdout;
  return null;
}

/**
 * Heuristic check: does the output look like source code?
 * Checks for common code keywords or sufficient length (>5 lines).
 */
function looksLikeSourceCode(output: string): boolean {
  const lines = output.split('\n');
  if (lines.length > 5) return true;
  const codePatterns = /\b(function|class|import|export|async|await|def|const|let|var|interface|type)\b/;
  return codePatterns.test(output);
}

/**
 * Detect language from source code content.
 * Falls back to 'typescript' as the default for JS/TS-like code.
 */
function detectLanguage(source: string): SupportedLanguage {
  // Python indicators
  if (/\bdef\s+\w+\s*\(/.test(source) || (/\bimport\s+\w+/.test(source) && /:\s*$/m.test(source))) {
    return 'python';
  }
  // TypeScript indicators (type annotations, interfaces, etc.)
  if (/\b(interface|type)\s+\w+/.test(source) || /:\s*(string|number|boolean|void)\b/.test(source)) {
    return 'typescript';
  }
  // Default to typescript (superset of javascript)
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
