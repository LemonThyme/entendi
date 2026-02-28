import { loadConfig } from '../shared/config.js';
import { type HookInput, log, readStdin } from './shared.js';

export interface UserPromptSubmitOutput {
  hookSpecificOutput?: {
    additionalContext?: string;
  };
}

// --- Login pattern detection ---

const LOGIN_PATTERNS = [
  /entendi\s+log\s*in/i,
  /entendi\s+login/i,
  /log\s*in\s+(?:to\s+)?entendi/i,
  /link\s+(?:my\s+)?(?:entendi\s+)?account/i,
  /entendi\s+auth/i,
];

export function detectLoginPattern(prompt: string): boolean {
  return LOGIN_PATTERNS.some((p) => p.test(prompt));
}

// --- Teach-me pattern detection ---

const TEACH_ME_PATTERNS = [
  /teach\s+me\s+(?:about\s+)?(.+)/i,
  /explain\s+(.+?)(?:\s+to\s+me)?$/i,
  /help\s+me\s+understand\s+(.+)/i,
];

export function detectTeachMePattern(prompt: string): string | null {
  for (const pattern of TEACH_ME_PATTERNS) {
    const match = prompt.match(pattern);
    if (!match) continue;
    const extractedName = match[1].trim().replace(/[?.!]+$/, '').trim();
    if (extractedName) return extractedName;
  }
  return null;
}

// --- API client for pending actions ---

async function fetchPendingAction(): Promise<any | null> {
  const config = loadConfig();
  const apiUrl = config.apiUrl;
  const apiKey = config.apiKey;
  if (!apiKey) {
    log('hook:user-prompt-submit', 'fetchPendingAction: no API key configured');
    return null;
  }

  try {
    log('hook:user-prompt-submit', 'fetchPendingAction: calling API', { url: `${apiUrl}/api/mcp/pending-action` });
    const res = await fetch(`${apiUrl}/api/mcp/pending-action`, {
      headers: { 'x-api-key': apiKey },
    });
    if (!res.ok) {
      log('hook:user-prompt-submit', 'fetchPendingAction: API error', { status: res.status });
      return null;
    }
    const data = await res.json() as { pending: any | null };
    log('hook:user-prompt-submit', 'fetchPendingAction: result', data);
    return data.pending;
  } catch (err) {
    log('hook:user-prompt-submit', 'fetchPendingAction: exception', { error: String(err) });
    return null;
  }
}

// --- Main handler ---

export async function handleUserPromptSubmit(
  input: HookInput,
): Promise<UserPromptSubmitOutput | null> {
  const userPrompt = (input.prompt as string) ?? '';

  // 0. Check for login request (must run before pending action — user may not have an API key yet)
  if (detectLoginPattern(userPrompt)) {
    log('hook:user-prompt-submit', 'login pattern detected');
    return {
      hookSpecificOutput: {
        additionalContext:
          `[Entendi] The user wants to log in to Entendi. ` +
          `Call entendi_login (with no arguments) to start the device-code authentication flow.`,
      },
    };
  }

  // 1. Check for pending action via API
  const pending = await fetchPendingAction();

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
  log('hook:user-prompt-submit', 'started');
  const raw = await readStdin();
  if (!raw || !raw.trim()) {
    log('hook:user-prompt-submit', 'empty stdin, exiting');
    process.exitCode = 0;
    return;
  }
  log('hook:user-prompt-submit', 'stdin received', { length: raw.length, preview: raw.slice(0, 200) });
  let input: HookInput;
  try {
    input = JSON.parse(raw);
  } catch {
    log('hook:user-prompt-submit', 'invalid JSON, exiting');
    process.exitCode = 0;
    return;
  }
  const result = await handleUserPromptSubmit(input);

  if (result?.hookSpecificOutput?.additionalContext) {
    const text = result.hookSpecificOutput.additionalContext;
    log('hook:user-prompt-submit', 'output (plain text)', { length: text.length, preview: text.slice(0, 300) });
    await new Promise<void>((resolve, reject) => {
      process.stdout.write(text, (err) => err ? reject(err) : resolve());
    });
  } else {
    log('hook:user-prompt-submit', 'no output (null result)');
  }

  process.exitCode = 0;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  main().catch((err) => {
    log('hook:user-prompt-submit', 'fatal error', { error: String(err), stack: (err as Error)?.stack });
    process.exitCode = 0;
  });
}
