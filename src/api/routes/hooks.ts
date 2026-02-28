import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { pendingActions } from '../db/schema.js';
import type { Env } from '../index.js';
import { requireAuth } from '../middleware/auth.js';

export const hookRoutes = new Hono<Env>();

// All hook routes require authentication
hookRoutes.use('*', requireAuth);

// --- Schemas ---

const userPromptSubmitSchema = z.object({
  session_id: z.string().optional(),
  hook_event_name: z.string().optional(),
  prompt: z.string().default(''),
});

const postToolUseSchema = z
  .object({
    session_id: z.string().optional(),
    hook_event_name: z.string().optional(),
    tool_name: z.string().default(''),
    tool_input: z.record(z.string(), z.unknown()).optional(),
    tool_output: z.string().optional(),
  })
  .passthrough();

// --- Login pattern detection ---

const LOGIN_PATTERNS = [
  /entendi\s+log\s*in/i,
  /entendi\s+login/i,
  /log\s*in\s+(?:to\s+)?entendi/i,
  /link\s+(?:my\s+)?(?:entendi\s+)?account/i,
  /entendi\s+auth/i,
];

const TEACH_ME_PATTERNS = [
  /teach\s+me\s+(?:about\s+)?(.+)/i,
  /explain\s+(.+?)(?:\s+to\s+me)?$/i,
  /help\s+me\s+understand\s+(.+)/i,
];

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

/**
 * POST /hooks/user-prompt-submit
 *
 * HTTP hook endpoint for UserPromptSubmit — replaces bash→node→fetch chain.
 * Receives hook input JSON directly from Claude Code, returns additionalContext.
 */
hookRoutes.post('/user-prompt-submit', async (c) => {
  const user = c.get('user')!;
  const body = userPromptSubmitSchema.parse(await c.req.json());
  const prompt = body.prompt;

  // 1. Login pattern
  if (LOGIN_PATTERNS.some((p) => p.test(prompt))) {
    return c.json({
      additionalContext:
        `[Entendi] The user wants to log in to Entendi. ` +
        `Call entendi_login (with no arguments) to start the device-code authentication flow.`,
    });
  }

  // 2. Check for pending action
  const db = c.get('db');
  const rows = await db
    .select()
    .from(pendingActions)
    .where(eq(pendingActions.userId, user.id))
    .limit(1);

  const pending = rows[0];
  if (pending) {
    const data = pending.data as Record<string, unknown> | null;
    const type = pending.actionType;
    const conceptId = (data as any)?.conceptId ?? 'unknown';

    switch (type) {
      case 'awaiting_probe_response':
        return c.json({
          additionalContext:
            `[Entendi] There is a pending comprehension probe about '${conceptId}'. ` +
            `If the user's message is a response to this probe, evaluate their understanding ` +
            `on a 0-3 rubric and call entendi_record_evaluation. If they changed topic, call entendi_dismiss.`,
        });

      case 'tutor_offered':
        return c.json({
          additionalContext:
            `[Entendi] A tutor session was offered for '${conceptId}' after a low probe score. ` +
            `If the user accepts, call entendi_start_tutor with conceptId '${conceptId}' ` +
            `and triggerScore ${(data as any)?.triggerScore ?? 'null'}. If they decline, call entendi_dismiss.`,
        });

      case 'tutor_active': {
        const phase = (data as any)?.phase as string;
        return c.json({
          additionalContext:
            `[Entendi] Active tutor session on '${conceptId}', currently in ${phase}. ` +
            `${getTutorPhaseInstructions(phase)} ` +
            `If the user says 'skip' or 'never mind', call entendi_dismiss.`,
        });
      }
    }
  }

  // 3. Teach-me pattern
  for (const pattern of TEACH_ME_PATTERNS) {
    const match = prompt.match(pattern);
    if (match) {
      const conceptName = match[1].trim().replace(/[?.!]+$/, '').trim();
      if (conceptName) {
        return c.json({
          additionalContext:
            `[Entendi] The user is requesting to learn about '${conceptName}'. ` +
            `Call entendi_start_tutor with conceptId '${conceptName}' and triggerScore null.`,
        });
      }
    }
  }

  // 4. No action needed
  return c.json({});
});

/**
 * POST /hooks/post-tool-use
 *
 * Analytics endpoint for PostToolUse hook — records tool usage metrics.
 * Privacy-preserving: only logs tool name, success, and concept IDs.
 */
hookRoutes.post('/post-tool-use', async (c) => {
  const body = postToolUseSchema.parse(await c.req.json());

  // Log to console for now — structured analytics storage is a future enhancement
  console.log(`[hook:post-tool-use] tool=${body.tool_name} session=${body.session_id ?? 'unknown'}`);

  return c.json({ ok: true });
});
