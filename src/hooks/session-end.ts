import { writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { loadConfig } from '../shared/config.js';
import { apiHeaders, log, readStdin } from './shared.js';

/**
 * SessionEnd hook — clean teardown when session terminates.
 * Dismisses pending probes, marks active tutors as interrupted.
 * Never blocks shutdown (always exits 0).
 */

function writeDismissMarker(conceptId: string): void {
  try {
    const markerPath = join(homedir(), '.entendi', 'pending-dismiss.json');
    writeFileSync(markerPath, JSON.stringify({
      conceptId,
      reason: 'session_ended',
      ts: Date.now(),
    }));
  } catch { /* non-critical */ }
}

export async function cleanupSession(): Promise<void> {
  const config = loadConfig();
  const { apiUrl, apiKey } = config;

  if (!apiKey) {
    log('hook:session-end', 'no API key, skipping cleanup');
    return;
  }

  let lastConceptId = 'unknown';
  try {
    // Check for pending actions
    const res = await fetch(`${apiUrl}/api/mcp/pending-action`, {
      headers: apiHeaders(config),
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      log('hook:session-end', 'API error checking pending actions', { status: res.status });
      return;
    }

    const data = (await res.json()) as {
      pending: { type: string; conceptId?: string; sessionId?: string } | null;
    };

    if (!data.pending) {
      log('hook:session-end', 'no pending actions to clean up');
      return;
    }

    const { type, conceptId } = data.pending;
    lastConceptId = conceptId ?? 'unknown';
    log('hook:session-end', 'cleaning up pending action', { type, conceptId });

    // Dismiss any pending probes or tutor offers (session ended = topic_change)
    if (type === 'awaiting_probe_response' || type === 'tutor_offered' || type === 'tutor_active') {
      const dismissRes = await fetch(`${apiUrl}/api/mcp/dismiss`, {
        method: 'POST',
        headers: {
          ...apiHeaders(config),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ reason: 'session_ended' }),
        signal: AbortSignal.timeout(5000),
      });

      if (dismissRes.ok) {
        log('hook:session-end', 'dismissed pending action', { type, conceptId });
      } else {
        log('hook:session-end', 'failed to dismiss pending action', {
          status: dismissRes.status,
        });
        writeDismissMarker(lastConceptId);
      }
    }
  } catch (err) {
    log('hook:session-end', 'exception during cleanup', { error: String(err) });
    writeDismissMarker(lastConceptId);
  }
}

async function main() {
  const startTime = Date.now();
  log('hook:session-end', 'session ending');

  await readStdin(); // consume stdin
  await cleanupSession();

  const duration = Date.now() - startTime;
  log('hook:session-end', `done (${duration}ms)`);
  process.exitCode = 0;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  main().catch((err) => {
    log('hook:session-end', 'fatal error', { error: String(err), stack: (err as Error)?.stack });
    process.exitCode = 0;
  });
}
