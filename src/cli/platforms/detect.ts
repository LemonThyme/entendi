import { existsSync } from 'fs';
import { join } from 'path';

export interface Platform {
  id: 'cursor' | 'codex' | 'vscode' | 'opencode';
  name: string;
}

const PROJECT_CHECKS: Array<{ id: Platform['id']; name: string; check: (dir: string) => boolean }> = [
  { id: 'cursor', name: 'Cursor', check: (dir) => existsSync(join(dir, '.cursor')) },
  { id: 'codex', name: 'Codex', check: (dir) => existsSync(join(dir, '.codex')) },
  { id: 'vscode', name: 'VS Code', check: (dir) => existsSync(join(dir, '.vscode')) },
  { id: 'opencode', name: 'OpenCode', check: (dir) => existsSync(join(dir, 'opencode.json')) },
];

/**
 * Detect AI coding platforms present in the given project directory.
 * Returns an array of detected platforms.
 */
export function detectPlatforms(projectDir: string): Platform[] {
  const detected: Platform[] = [];

  for (const { id, name, check } of PROJECT_CHECKS) {
    if (check(projectDir)) {
      detected.push({ id, name });
    }
  }

  return detected;
}
