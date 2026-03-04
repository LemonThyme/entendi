import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { loadConfig } from '../shared/config.js';
import { type HookInput, apiHeaders, log, readStdin } from './shared.js';
import { findLastUserMessage, hasObserveCallInCurrentTurn } from './transcript.js';
import { isTrivialMessage } from './trivial.js';

/**
 * Stop hook — fires when the session is about to end.
 * 1. Checks if entendi_observe was called this turn (enforcement).
 * 2. Checks for dangling probe actions and logs a warning if found.
 */

export interface StopInput extends HookInput {
  transcript_path?: string;
  stop_hook_active?: boolean;
}

export interface StopOutput {
  decision: 'block';
  reason: string;
}

interface EnforcementCache {
  enforcement: string;
  userPrompt?: string;
}

function readEnforcementCache(homeDir?: string): EnforcementCache {
  try {
    const dir = homeDir ?? homedir();
    const raw = readFileSync(join(dir, '.entendi', 'enforcement-cache.json'), 'utf-8');
    const data = JSON.parse(raw);
    // Ignore stale cache (> 5 minutes old)
    if (Date.now() - data.ts > 5 * 60 * 1000) return { enforcement: 'remind' };
    return {
      enforcement: data.enforcement ?? 'remind',
      userPrompt: data.userPrompt,
    };
  } catch {
    return { enforcement: 'remind' };
  }
}

export async function handleStop(input: StopInput, homeDir?: string): Promise<StopOutput | null> {
  // 1. Prevent infinite loops
  if (input.stop_hook_active) {
    log('hook:stop', 'stop_hook_active is true, allowing stop');
    return null;
  }

  // 2. Check enforcement level
  const cache = readEnforcementCache(homeDir);
  if (cache.enforcement === 'off') {
    log('hook:stop', 'enforcement is off, allowing stop');
    return null;
  }

  // 3. Check transcript for observe call
  const transcriptPath = input.transcript_path;
  if (!transcriptPath) {
    log('hook:stop', 'no transcript_path, allowing stop');
    return null;
  }

  if (hasObserveCallInCurrentTurn(transcriptPath)) {
    log('hook:stop', 'observe was called this turn, allowing stop');
    return null;
  }

  // 4. Use cached userPrompt for trivial detection (fixes AskUserQuestion false trivial)
  // Fall back to transcript if cache doesn't have it
  const userMessage = cache.userPrompt ?? findLastUserMessage(transcriptPath);
  if (!userMessage || isTrivialMessage(userMessage)) {
    log('hook:stop', 'trivial or empty message, skipping observe enforcement');
    return null;
  }

  // 5. Enforce or remind
  if (cache.enforcement === 'enforce') {
    log('hook:stop', 'observe NOT called, blocking stop', { enforcement: cache.enforcement, userMessage: userMessage.slice(0, 100) });
    return {
      decision: 'block',
      reason:
        `[Entendi] You did not call entendi_observe this turn. Identify technical ` +
        `concepts from the user's message and your work, then call entendi_observe before finishing.`,
    };
  }

  // enforcement === 'remind'
  log('hook:stop', 'observe NOT called (remind mode, not blocking)', { userMessage: userMessage.slice(0, 100) });
  return null;
}

async function checkDanglingProbes(): Promise<void> {
  const config = loadConfig();
  const apiUrl = config.apiUrl;
  const apiKey = config.apiKey;

  if (!apiKey) {
    log('hook:stop', 'no API key configured, skipping dangling probe check');
    return;
  }

  try {
    log('hook:stop', 'checking for dangling probes', { url: `${apiUrl}/api/mcp/pending-action` });
    const res = await fetch(`${apiUrl}/api/mcp/pending-action`, {
      headers: apiHeaders(config),
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      log('hook:stop', 'API error checking pending actions', { status: res.status });
      return;
    }

    const data = (await res.json()) as { pending: { type: string; conceptId?: string } | null };

    if (data.pending) {
      log('hook:stop', 'WARNING: dangling probe detected at session end', {
        type: data.pending.type,
        conceptId: data.pending.conceptId ?? 'unknown',
      });
    } else {
      log('hook:stop', 'no dangling probes found');
    }
  } catch (err) {
    log('hook:stop', 'exception checking dangling probes', { error: String(err) });
  }
}

async function main() {
  log('hook:stop', 'session ending');
  const raw = await readStdin();
  let input: StopInput = { session_id: '', cwd: '', hook_event_name: 'Stop' };
  try {
    input = JSON.parse(raw);
  } catch {
    /* invalid input — still check for dangling probes */
  }

  // Observe enforcement check
  const result = await handleStop(input);
  if (result) {
    process.stdout.write(JSON.stringify(result));
    process.exitCode = 0;
    return;
  }

  // Existing dangling probe check
  await checkDanglingProbes();

  log('hook:stop', 'done');
  process.exitCode = 0;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  main().catch((err) => {
    log('hook:stop', 'fatal error', { error: String(err), stack: (err as Error)?.stack });
    process.exitCode = 0;
  });
}
