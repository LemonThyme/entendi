import { readStdin, getDataDir, getUserId, type HookInput } from './shared.js';
import {
  detectPackageInstall,
  parsePackageFromCommand,
  extractConceptsFromPackage,
} from '../core/concept-extraction.js';
import { KnowledgeGraph } from '../core/knowledge-graph.js';
import { StateManager } from '../core/state-manager.js';
import { shouldProbe } from '../core/probe-scheduler.js';
import { generateProbe } from '../core/probe-engine.js';
import type { ConceptNode } from '../schemas/types.js';

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

  // 5. Map to concepts
  const allConcepts = packages.flatMap((pkg) => extractConceptsFromPackage(pkg));
  if (allConcepts.length === 0) return null;

  // 6. Load state and ensure concepts exist in knowledge graph
  const dataDir = getDataDir(input.cwd);
  const userId = getUserId();
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
      };
      kg.addConcept(node);
    }
  }

  // Classify novelty for the first concept (most relevant)
  const primaryConcept = uniqueConcepts[0]!;
  const novelty = kg.classifyNovelty(userId, primaryConcept.name);

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
    question = `I noticed you're using ${primaryConcept.name}. Can you explain why you chose it for this project?`;
  } else {
    const probe = await generateProbe({
      conceptName: primaryConcept.name,
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
      conceptId: primaryConcept.name,
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
  main().catch(() => process.exit(0));
}
