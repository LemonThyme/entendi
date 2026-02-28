// tests/core/probe-token.test.ts
import { describe, expect, it } from 'vitest';
import { createProbeToken, verifyProbeToken } from '../../src/core/probe-token.js';

const SECRET = 'test-secret-at-least-32-characters-long-for-hmac';

describe('probe-token', () => {
  describe('createProbeToken', () => {
    it('creates a token with all required fields', () => {
      const token = createProbeToken({
        userId: 'user-1',
        conceptId: 'redis',
        depth: 2,
        evaluationCriteria: 'Must mention persistence tradeoffs',
        secret: SECRET,
        ttlMs: 30 * 60 * 1000,
      });
      expect(token.tokenId).toBeDefined();
      expect(token.userId).toBe('user-1');
      expect(token.conceptId).toBe('redis');
      expect(token.depth).toBe(2);
      expect(token.evaluationCriteria).toBe('Must mention persistence tradeoffs');
      expect(token.signature).toBeDefined();
      expect(typeof token.signature).toBe('string');
      expect(new Date(token.expiresAt).getTime()).toBeGreaterThan(Date.now());
    });
  });

  describe('verifyProbeToken', () => {
    it('accepts a valid token', () => {
      const token = createProbeToken({
        userId: 'user-1', conceptId: 'redis', depth: 2,
        evaluationCriteria: '', secret: SECRET, ttlMs: 30 * 60 * 1000,
      });
      const result = verifyProbeToken(token, SECRET);
      expect(result.valid).toBe(true);
    });

    it('rejects a token with tampered signature', () => {
      const token = createProbeToken({
        userId: 'user-1', conceptId: 'redis', depth: 2,
        evaluationCriteria: '', secret: SECRET, ttlMs: 30 * 60 * 1000,
      });
      token.signature = 'tampered';
      const result = verifyProbeToken(token, SECRET);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('invalid_signature');
    });

    it('rejects a token with tampered conceptId', () => {
      const token = createProbeToken({
        userId: 'user-1', conceptId: 'redis', depth: 2,
        evaluationCriteria: '', secret: SECRET, ttlMs: 30 * 60 * 1000,
      });
      token.conceptId = 'hacked';
      const result = verifyProbeToken(token, SECRET);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('invalid_signature');
    });

    it('rejects an expired token', () => {
      const token = createProbeToken({
        userId: 'user-1', conceptId: 'redis', depth: 2,
        evaluationCriteria: '', secret: SECRET, ttlMs: -1000, // already expired
      });
      const result = verifyProbeToken(token, SECRET);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('expired');
    });

    it('rejects a token signed with wrong secret', () => {
      const token = createProbeToken({
        userId: 'user-1', conceptId: 'redis', depth: 2,
        evaluationCriteria: '', secret: SECRET, ttlMs: 30 * 60 * 1000,
      });
      const result = verifyProbeToken(token, 'wrong-secret-that-is-also-long-enough');
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('invalid_signature');
    });

    it('validates userId matches', () => {
      const token = createProbeToken({
        userId: 'user-1', conceptId: 'redis', depth: 2,
        evaluationCriteria: '', secret: SECRET, ttlMs: 30 * 60 * 1000,
      });
      const result = verifyProbeToken(token, SECRET, { userId: 'user-2' });
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('user_mismatch');
    });

    it('validates conceptId matches', () => {
      const token = createProbeToken({
        userId: 'user-1', conceptId: 'redis', depth: 2,
        evaluationCriteria: '', secret: SECRET, ttlMs: 30 * 60 * 1000,
      });
      const result = verifyProbeToken(token, SECRET, { conceptId: 'mongodb' });
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('concept_mismatch');
    });
  });
});
