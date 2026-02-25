import { readStdin, getDataDir, type HookInput } from './shared.js';
import { readPendingAction } from '../mcp/pending-action.js';
import type { PendingAction } from '../schemas/types.js';

export interface UserPromptSubmitOutput {
  hookSpecificOutput?: {
    additionalContext?: string;
  };
}

interface UserPromptSubmitOptions {
  dataDir?: string;
  skipLLM?: boolean;
  userId?: string;
}

// --- Teach-me pattern detection ---

const TEACH_ME_PATTERNS = [
  /teach\s+me\s+(?:about\s+)?(.+)/i,
  /explain\s+(.+?)(?:\s+to\s+me)?$/i,
  /help\s+me\s+understand\s+(.+)/i,
];

/**
 * Detect "teach me about X" / "explain X" / "help me understand X" patterns.
 * Returns the extracted concept name (raw) or null if no match.
 * Does NOT validate against a knowledge graph — Claude + MCP handle that.
 */
export function detectTeachMePattern(prompt: string): string | null {
  for (const pattern of TEACH_ME_PATTERNS) {
    const match = prompt.match(pattern);
    if (!match) continue;
    const extractedName = match[1].trim().replace(/[?.!]+$/, '').trim();
    if (extractedName) return extractedName;
  }
  return null;
}

// --- Main handler ---

export async function handleUserPromptSubmit(
  input: HookInput,
  options: UserPromptSubmitOptions = {},
): Promise<UserPromptSubmitOutput | null> {
  const dataDir = options.dataDir ?? getDataDir(input.cwd);
  const userPrompt = (input.prompt as string) ?? '';

  // 1. Read pending action (written by MCP server)
  const pending: PendingAction | null = readPendingAction(dataDir);

  if (pending) {
    switch (pending.type) {
      case 'awaiting_probe_response':
        return {
          hookSpecificOutput: {
            additionalContext:
              `[Entendi] There is a pending comprehension probe about '${pending.conceptId}'. ` +
              `If the user's message is a response to this probe, evaluate their understanding ` +
              `on a 0-3 rubric (0=no understanding, 1=surface, 2=functional, 3=deep/transferable) ` +
              `and call entendi_record_evaluation with the score, confidence (0-1), reasoning, ` +
              `and eventType 'probe'. If the user is NOT responding to the probe (they changed ` +
              `topic), call entendi_dismiss instead.`,
          },
        };

      case 'tutor_offered':
        return {
          hookSpecificOutput: {
            additionalContext:
              `[Entendi] A tutor session was offered for '${pending.conceptId}' after a low probe score. ` +
              `If the user accepts (yes/sure/ok), call entendi_start_tutor with conceptId '${pending.conceptId}' ` +
              `and triggerScore ${pending.triggerScore}. If they decline, call entendi_dismiss.`,
          },
        };

      case 'tutor_active': {
        const phaseInstructions = getTutorPhaseInstructions(pending.phase as string);
        return {
          hookSpecificOutput: {
            additionalContext:
              `[Entendi] Active tutor session on '${pending.conceptId}', currently in ${pending.phase}. ` +
              `${phaseInstructions} ` +
              `If the user says 'skip' or 'never mind', call entendi_dismiss.`,
          },
        };
      }
    }
  }

  // 2. No pending action — check for "teach me about X" pattern
  const conceptName = detectTeachMePattern(userPrompt);
  if (conceptName) {
    return {
      hookSpecificOutput: {
        additionalContext:
          `[Entendi] The user is requesting to learn about '${conceptName}'. ` +
          `Call entendi_start_tutor with conceptId '${conceptName}' and triggerScore null.`,
      },
    };
  }

  // 3. Nothing to do
  return null;
}

function getTutorPhaseInstructions(phase: string): string {
  switch (phase) {
    case 'phase1':
      return 'Evaluate their response on the 0-3 rubric. Call entendi_advance_tutor with score, confidence, reasoning.';
    case 'phase2':
      return 'Note any misconceptions. Call entendi_advance_tutor with userResponse and any detected misconception.';
    case 'phase3':
      return 'Note any remaining misconceptions. Call entendi_advance_tutor with userResponse.';
    case 'phase4':
      return 'Evaluate their final response on the 0-3 rubric. Call entendi_advance_tutor with score, confidence, reasoning.';
    default:
      return 'Call entendi_advance_tutor with the user response.';
  }
}

async function main() {
  const raw = await readStdin();
  const input: HookInput = JSON.parse(raw);
  const result = await handleUserPromptSubmit(input);

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
