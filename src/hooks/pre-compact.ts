import { loadConfig } from '../shared/config.js';
import { apiHeaders, log, readStdin } from './shared.js';

/**
 * PreCompact hook — preserves critical probe/tutor state before context compaction.
 * Returns additionalContext so state survives compaction.
 */

async function fetchPendingState(): Promise<string | null> {
  const config = loadConfig();
  const { apiUrl, apiKey } = config;
  if (!apiKey) {
    log('hook:pre-compact', 'no API key, skipping state preservation');
    return null;
  }

  try {
    const res = await fetch(`${apiUrl}/api/mcp/pending-action`, {
      headers: apiHeaders(config),
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      log('hook:pre-compact', 'API error fetching pending state', { status: res.status });
      return null;
    }

    const data = (await res.json()) as { pending: { type: string; conceptId?: string; phase?: string } | null };

    if (!data.pending) {
      log('hook:pre-compact', 'no pending state to preserve');
      return null;
    }

    const { type, conceptId, phase } = data.pending;
    log('hook:pre-compact', 'preserving pending state', { type, conceptId });

    switch (type) {
      case 'awaiting_probe_response':
        return (
          `[Entendi] PRESERVED STATE: There is a pending comprehension probe about '${conceptId}'. ` +
          `The user has been asked a probe question. If their next message responds to this probe, ` +
          `evaluate on a 0-3 rubric and call entendi_record_evaluation. If they changed topic, call entendi_dismiss.`
        );

      case 'tutor_active':
        return (
          `[Entendi] PRESERVED STATE: Active tutor session on '${conceptId}', phase: ${phase}. ` +
          `Continue the tutor dialogue. Call entendi_advance_tutor with the user's response.`
        );

      case 'tutor_offered':
        return (
          `[Entendi] PRESERVED STATE: A tutor session was offered for '${conceptId}'. ` +
          `If the user accepts, call entendi_start_tutor. If they decline, call entendi_dismiss.`
        );

      default:
        return `[Entendi] PRESERVED STATE: Pending action type '${type}' for concept '${conceptId}'.`;
    }
  } catch (err) {
    log('hook:pre-compact', 'exception fetching state', { error: String(err) });
    return null;
  }
}

async function main() {
  log('hook:pre-compact', 'context compaction starting');
  await readStdin(); // consume stdin even if we don't use it

  const stateContext = await fetchPendingState();

  if (stateContext) {
    log('hook:pre-compact', 'outputting preserved state', { length: stateContext.length });
    await new Promise<void>((resolve, reject) => {
      process.stdout.write(stateContext, (err) => (err ? reject(err) : resolve()));
    });
  } else {
    log('hook:pre-compact', 'no state to preserve');
  }

  process.exitCode = 0;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  main().catch((err) => {
    log('hook:pre-compact', 'fatal error', { error: String(err), stack: (err as Error)?.stack });
    process.exitCode = 0;
  });
}
