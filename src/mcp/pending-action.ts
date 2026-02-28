import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { PendingAction } from '../schemas/types.js';

export type { PendingAction } from '../schemas/types.js';

const PENDING_ACTION_FILE = 'pending-action.json';

/**
 * Atomically write a PendingAction to disk.
 * Uses write-to-temp + rename for atomicity.
 */
export function writePendingAction(dataDir: string, action: PendingAction): void {
  mkdirSync(dataDir, { recursive: true });
  const filePath = join(dataDir, PENDING_ACTION_FILE);
  const tmpPath = filePath + '.tmp';
  writeFileSync(tmpPath, JSON.stringify(action, null, 2), 'utf-8');
  renameSync(tmpPath, filePath);
}

/**
 * Read the current PendingAction from disk.
 * Returns null if the file doesn't exist or contains invalid JSON.
 */
export function readPendingAction(dataDir: string): PendingAction | null {
  try {
    const filePath = join(dataDir, PENDING_ACTION_FILE);
    const raw = readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as PendingAction;
  } catch {
    return null;
  }
}

/**
 * Delete the pending action file.
 * Does not throw if the file doesn't exist.
 */
export function clearPendingAction(dataDir: string): void {
  try {
    const filePath = join(dataDir, PENDING_ACTION_FILE);
    unlinkSync(filePath);
  } catch {
    // Ignore errors (file may not exist)
  }
}
