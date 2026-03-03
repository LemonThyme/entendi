import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { detectPlatforms, type Platform } from '../../src/cli/platforms/detect.js';

describe('detectPlatforms', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `entendi-detect-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns empty array when no platforms detected', () => {
    const platforms = detectPlatforms(tempDir);
    expect(platforms).toEqual([]);
  });

  it('detects Cursor from .cursor/ directory', () => {
    mkdirSync(join(tempDir, '.cursor'));
    const platforms = detectPlatforms(tempDir);
    expect(platforms).toContainEqual<Platform>({ id: 'cursor', name: 'Cursor' });
  });

  it('detects Codex from .codex/ directory', () => {
    mkdirSync(join(tempDir, '.codex'));
    const platforms = detectPlatforms(tempDir);
    expect(platforms).toContainEqual<Platform>({ id: 'codex', name: 'Codex' });
  });

  it('detects VS Code from .vscode/ directory', () => {
    mkdirSync(join(tempDir, '.vscode'));
    const platforms = detectPlatforms(tempDir);
    expect(platforms).toContainEqual<Platform>({ id: 'vscode', name: 'VS Code' });
  });

  it('detects OpenCode from opencode.json file', () => {
    writeFileSync(join(tempDir, 'opencode.json'), '{}');
    const platforms = detectPlatforms(tempDir);
    expect(platforms).toContainEqual<Platform>({ id: 'opencode', name: 'OpenCode' });
  });

  it('detects multiple platforms simultaneously', () => {
    mkdirSync(join(tempDir, '.cursor'));
    mkdirSync(join(tempDir, '.codex'));
    mkdirSync(join(tempDir, '.vscode'));
    const platforms = detectPlatforms(tempDir);
    expect(platforms).toHaveLength(3);
    expect(platforms.map(p => p.id)).toContain('cursor');
    expect(platforms.map(p => p.id)).toContain('codex');
    expect(platforms.map(p => p.id)).toContain('vscode');
  });

  it('does not include Claude Code in project detection (it uses ~/.claude/)', () => {
    // Claude Code detection is global, not project-level
    mkdirSync(join(tempDir, '.claude'));
    const platforms = detectPlatforms(tempDir);
    // .claude in project dir should NOT trigger claude detection
    // Claude is detected via homedir only
    expect(platforms.map(p => p.id)).not.toContain('claude');
  });
});
