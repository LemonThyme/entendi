import { loadConfig } from '../shared/config.js';
import { log, readStdin } from './shared.js';

/**
 * Notification hook (idle_prompt) — checks for pending probes when user is idle.
 * Surfaces a reminder if a probe is waiting for response.
 */

async function checkPendingProbe(): Promise<string | null> {
  const config = loadConfig();
  const { apiUrl, apiKey } = config;

  if (!apiKey) {
    return null;
  }

  try {
    const res = await fetch(`${apiUrl}/api/mcp/pending-action`, {
      headers: { 'x-api-key': apiKey },
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) return null;

    const data = (await res.json()) as { pending: { type: string; conceptId?: string } | null };

    if (!data.pending) return null;

    if (data.pending.type === 'awaiting_probe_response') {
      return `[Entendi] Reminder: A comprehension probe about '${data.pending.conceptId}' is waiting for your response.`;
    }

    if (data.pending.type === 'tutor_active') {
      return `[Entendi] Reminder: An active tutor session on '${data.pending.conceptId}' is waiting for your response.`;
    }

    return null;
  } catch (err) {
    log('hook:notification', 'exception checking pending', { error: String(err) });
    return null;
  }
}

async function main() {
  log('hook:notification', 'idle_prompt notification');
  await readStdin(); // consume stdin

  const reminder = await checkPendingProbe();

  if (reminder) {
    log('hook:notification', 'pending probe reminder', { length: reminder.length });
    await new Promise<void>((resolve, reject) => {
      process.stdout.write(reminder, (err) => (err ? reject(err) : resolve()));
    });
  } else {
    log('hook:notification', 'no pending probes');
  }

  process.exitCode = 0;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  main().catch((err) => {
    log('hook:notification', 'fatal error', { error: String(err), stack: (err as Error)?.stack });
    process.exitCode = 0;
  });
}
