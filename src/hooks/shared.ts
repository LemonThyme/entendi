import { join } from 'path';

/** Read all stdin as a string (hooks receive JSON on stdin). */
export async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

/** Standard hook input fields. */
export interface HookInput {
  session_id: string;
  cwd: string;
  hook_event_name: string;
  [key: string]: unknown;
}

/** Get the Entendi data directory for this project. */
export function getDataDir(cwd: string): string {
  return join(cwd, '.entendi');
}

export function getUserId(): string {
  return process.env.ENTENDI_USER_ID ?? process.env.USER ?? 'default';
}
