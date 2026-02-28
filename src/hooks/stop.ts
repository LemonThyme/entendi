import { loadConfig } from '../shared/config.js';
import { log, readStdin } from './shared.js';

/**
 * Stop hook — fires when the session is about to end.
 * Checks for dangling probe actions and logs a warning if found.
 * Never blocks the session from ending (always exits 0).
 */

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
      headers: { 'x-api-key': apiKey },
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
  try {
    JSON.parse(raw);
  } catch {
    /* invalid input — still check for dangling probes */
  }

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
