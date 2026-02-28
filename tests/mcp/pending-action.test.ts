import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  clearPendingAction,
  type PendingAction,
  readPendingAction,
  writePendingAction,
} from '../../src/mcp/pending-action.js';

describe('PendingAction', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'entendi-pa-'));
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  describe('writePendingAction', () => {
    it('writes awaiting_probe_response action to disk', () => {
      const action: PendingAction = {
        type: 'awaiting_probe_response',
        conceptId: 'redis/caching',
        depth: 1,
        timestamp: '2026-02-25T12:00:00.000Z',
      };
      writePendingAction(dataDir, action);

      const filePath = join(dataDir, 'pending-action.json');
      expect(existsSync(filePath)).toBe(true);
      const written = JSON.parse(readFileSync(filePath, 'utf-8'));
      expect(written.type).toBe('awaiting_probe_response');
      expect(written.conceptId).toBe('redis/caching');
      expect(written.depth).toBe(1);
    });

    it('writes tutor_offered action to disk', () => {
      const action: PendingAction = {
        type: 'tutor_offered',
        conceptId: 'redis/caching',
        triggerScore: 1,
        timestamp: '2026-02-25T12:00:00.000Z',
      };
      writePendingAction(dataDir, action);
      const read = readPendingAction(dataDir);
      expect(read).not.toBeNull();
      expect(read!.type).toBe('tutor_offered');
      if (read!.type === 'tutor_offered') {
        expect(read!.triggerScore).toBe(1);
      }
    });

    it('writes tutor_active action to disk', () => {
      const action: PendingAction = {
        type: 'tutor_active',
        sessionId: 'tutor_123_abc',
        conceptId: 'redis/caching',
        phase: 'phase2',
        timestamp: '2026-02-25T12:00:00.000Z',
      };
      writePendingAction(dataDir, action);
      const read = readPendingAction(dataDir);
      expect(read).not.toBeNull();
      expect(read!.type).toBe('tutor_active');
      if (read!.type === 'tutor_active') {
        expect(read!.sessionId).toBe('tutor_123_abc');
        expect(read!.phase).toBe('phase2');
      }
    });

    it('overwrites a previous pending action', () => {
      writePendingAction(dataDir, {
        type: 'awaiting_probe_response',
        conceptId: 'redis/caching',
        depth: 1,
        timestamp: '2026-02-25T12:00:00.000Z',
      });
      writePendingAction(dataDir, {
        type: 'tutor_offered',
        conceptId: 'express/middleware',
        triggerScore: 0,
        timestamp: '2026-02-25T12:01:00.000Z',
      });
      const read = readPendingAction(dataDir);
      expect(read!.type).toBe('tutor_offered');
    });
  });

  describe('readPendingAction', () => {
    it('returns null when file does not exist', () => {
      expect(readPendingAction(dataDir)).toBeNull();
    });

    it('returns null when file is corrupted JSON', () => {
      const { writeFileSync, mkdirSync } = require('fs');
      mkdirSync(dataDir, { recursive: true });
      writeFileSync(join(dataDir, 'pending-action.json'), 'not json');
      expect(readPendingAction(dataDir)).toBeNull();
    });

    it('round-trips a valid action', () => {
      const action: PendingAction = {
        type: 'awaiting_probe_response',
        conceptId: 'react/hooks',
        depth: 2,
        timestamp: '2026-02-25T12:00:00.000Z',
      };
      writePendingAction(dataDir, action);
      const read = readPendingAction(dataDir);
      expect(read).toEqual(action);
    });
  });

  describe('clearPendingAction', () => {
    it('removes the pending action file', () => {
      writePendingAction(dataDir, {
        type: 'awaiting_probe_response',
        conceptId: 'redis/caching',
        depth: 1,
        timestamp: '2026-02-25T12:00:00.000Z',
      });
      clearPendingAction(dataDir);
      expect(readPendingAction(dataDir)).toBeNull();
      expect(existsSync(join(dataDir, 'pending-action.json'))).toBe(false);
    });

    it('does not throw when file does not exist', () => {
      expect(() => clearPendingAction(dataDir)).not.toThrow();
    });
  });
});
