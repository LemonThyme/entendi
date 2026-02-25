import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { createDefaultOrgPolicy, createDefaultUserPreferences, type OrgPolicy, type UserPreferences } from './org-policy.js';

export interface ResolvedConfig {
  orgPolicy: OrgPolicy;
  userPrefs: UserPreferences;
}

export function loadConfig(dataDir: string, userPrefsPath?: string): ResolvedConfig {
  return {
    orgPolicy: loadOrgPolicy(dataDir),
    userPrefs: loadUserPreferences(userPrefsPath),
  };
}

function loadOrgPolicy(dataDir: string): OrgPolicy {
  const path = join(dataDir, 'org-policy.json');
  const defaults = createDefaultOrgPolicy();
  try {
    if (existsSync(path)) {
      const raw = JSON.parse(readFileSync(path, 'utf-8'));
      return { ...defaults, ...raw };
    }
  } catch {
    // Corrupted file — use defaults
  }
  return defaults;
}

function loadUserPreferences(prefsPath?: string): UserPreferences {
  const defaults = createDefaultUserPreferences();
  if (!prefsPath) return defaults;
  try {
    if (existsSync(prefsPath)) {
      const raw = JSON.parse(readFileSync(prefsPath, 'utf-8'));
      return { ...defaults, ...raw };
    }
  } catch {
    // Corrupted file — use defaults
  }
  return defaults;
}
