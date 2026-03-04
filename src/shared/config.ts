import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const CONFIG_DIR = join(homedir(), '.entendi');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

export interface EntendiConfig {
  apiUrl: string;
  apiKey?: string;
  orgId?: string;
}

/**
 * Load Entendi config. Priority: env vars > ~/.entendi/config.json > defaults.
 */
export function loadConfig(): EntendiConfig {
  // Start with defaults
  let fileConfig: Partial<EntendiConfig> = {};
  try {
    fileConfig = JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'));
  } catch {
    // No config file yet — that's fine
  }

  return {
    apiUrl: process.env.ENTENDI_API_URL || fileConfig.apiUrl || 'https://api.entendi.dev',
    // Config file takes priority — it's written by entendi_login (canonical auth flow).
    // Env var is a fallback for manual setup or CI.
    apiKey: fileConfig.apiKey || process.env.ENTENDI_API_KEY || undefined,
    orgId: (fileConfig as Record<string, unknown>).orgId as string | undefined,
  };
}

/**
 * Save API credentials to ~/.entendi/config.json.
 */
export function saveConfig(config: Partial<EntendiConfig>): void {
  let existing: Record<string, unknown> = {};
  try {
    existing = JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'));
  } catch {
    // Starting fresh
  }

  if (config.apiUrl) existing.apiUrl = config.apiUrl;
  if (config.apiKey) existing.apiKey = config.apiKey;
  if (config.orgId !== undefined) existing.orgId = config.orgId || undefined;

  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(existing, null, 2) + '\n', { mode: 0o600 });
}
