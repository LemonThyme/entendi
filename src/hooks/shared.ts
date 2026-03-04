import { appendFileSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import type { EntendiConfig } from '../shared/config.js';

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

// --- Debug logging ---

const LOG_DIR = join(homedir(), '.entendi');
const LOG_FILE = join(LOG_DIR, 'debug.log');
let logDirCreated = false;

export function log(component: string, message: string, data?: unknown): void {
  if (!logDirCreated) {
    try { mkdirSync(LOG_DIR, { recursive: true }); } catch {}
    logDirCreated = true;
  }
  const ts = new Date().toISOString();
  const dataStr = data !== undefined ? ` ${JSON.stringify(data)}` : '';
  try {
    appendFileSync(LOG_FILE, `[${ts}] [${component}] ${message}${dataStr}\n`);
  } catch {}
}

/** Build standard API headers from config (includes X-Org-Id when set). */
export function apiHeaders(config: EntendiConfig): Record<string, string> {
  const headers: Record<string, string> = { 'x-api-key': config.apiKey! };
  if (config.orgId) headers['X-Org-Id'] = config.orgId;
  return headers;
}
