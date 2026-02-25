import { describe, it, expect } from 'vitest';
import {
  advanceTutorPhase,
  isTutorActive,
  isTutorOffered,
  isPhaseScored,
  shouldOfferTutor,
  isTutorTimedOut,
  TUTOR_TIMEOUT_MS,
} from '../../src/core/tutor-session.js';
import { createTutorSession } from '../../src/schemas/types.js';
import type { TutorSession, TutorPhase, RubricScore } from '../../src/schemas/types.js';

function makeSession(phase: TutorPhase, startedAt?: string): TutorSession {
  const session = createTutorSession('test-concept', 1 as RubricScore);
  return { ...session, phase, ...(startedAt ? { startedAt, lastActivityAt: startedAt } : {}) };
}

describe('advanceTutorPhase', () => {
  it('advances offered → phase1', () => {
    const result = advanceTutorPhase(makeSession('offered'));
    expect(result.phase).toBe('phase1');
  });

  it('advances phase1 → phase2', () => {
    const result = advanceTutorPhase(makeSession('phase1'));
    expect(result.phase).toBe('phase2');
  });

  it('advances phase2 → phase3', () => {
    const result = advanceTutorPhase(makeSession('phase2'));
    expect(result.phase).toBe('phase3');
  });

  it('advances phase3 → phase4', () => {
    const result = advanceTutorPhase(makeSession('phase3'));
    expect(result.phase).toBe('phase4');
  });

  it('advances phase4 → complete', () => {
    const result = advanceTutorPhase(makeSession('phase4'));
    expect(result.phase).toBe('complete');
  });

  it('complete stays complete', () => {
    const result = advanceTutorPhase(makeSession('complete'));
    expect(result.phase).toBe('complete');
  });

  it('returns a new object (immutable)', () => {
    const original = makeSession('phase1');
    const result = advanceTutorPhase(original);
    expect(result).not.toBe(original);
    expect(original.phase).toBe('phase1');
  });
});

describe('isTutorActive', () => {
  it('returns true for phase1', () => {
    expect(isTutorActive(makeSession('phase1'))).toBe(true);
  });

  it('returns true for phase2', () => {
    expect(isTutorActive(makeSession('phase2'))).toBe(true);
  });

  it('returns true for phase3', () => {
    expect(isTutorActive(makeSession('phase3'))).toBe(true);
  });

  it('returns true for phase4', () => {
    expect(isTutorActive(makeSession('phase4'))).toBe(true);
  });

  it('returns false for offered', () => {
    expect(isTutorActive(makeSession('offered'))).toBe(false);
  });

  it('returns false for complete', () => {
    expect(isTutorActive(makeSession('complete'))).toBe(false);
  });

  it('returns false for null', () => {
    expect(isTutorActive(null)).toBe(false);
  });
});

describe('isTutorOffered', () => {
  it('returns true for offered', () => {
    expect(isTutorOffered(makeSession('offered'))).toBe(true);
  });

  it('returns false for phase1', () => {
    expect(isTutorOffered(makeSession('phase1'))).toBe(false);
  });

  it('returns false for complete', () => {
    expect(isTutorOffered(makeSession('complete'))).toBe(false);
  });

  it('returns false for null', () => {
    expect(isTutorOffered(null)).toBe(false);
  });
});

describe('isPhaseScored', () => {
  it('returns true for phase1', () => {
    expect(isPhaseScored('phase1')).toBe(true);
  });

  it('returns true for phase4', () => {
    expect(isPhaseScored('phase4')).toBe(true);
  });

  it('returns false for offered', () => {
    expect(isPhaseScored('offered')).toBe(false);
  });

  it('returns false for phase2', () => {
    expect(isPhaseScored('phase2')).toBe(false);
  });

  it('returns false for phase3', () => {
    expect(isPhaseScored('phase3')).toBe(false);
  });

  it('returns false for complete', () => {
    expect(isPhaseScored('complete')).toBe(false);
  });
});

describe('shouldOfferTutor', () => {
  it('returns true when score <= threshold and mode is reactive', () => {
    expect(shouldOfferTutor(1 as RubricScore, 1 as RubricScore, 'reactive')).toBe(true);
  });

  it('returns true when score < threshold and mode is reactive', () => {
    expect(shouldOfferTutor(0 as RubricScore, 1 as RubricScore, 'reactive')).toBe(true);
  });

  it('returns true when score <= threshold and mode is both', () => {
    expect(shouldOfferTutor(1 as RubricScore, 2 as RubricScore, 'both')).toBe(true);
  });

  it('returns false when score > threshold', () => {
    expect(shouldOfferTutor(2 as RubricScore, 1 as RubricScore, 'reactive')).toBe(false);
  });

  it('returns false when mode is off', () => {
    expect(shouldOfferTutor(0 as RubricScore, 3 as RubricScore, 'off')).toBe(false);
  });

  it('returns false when mode is proactive', () => {
    expect(shouldOfferTutor(0 as RubricScore, 3 as RubricScore, 'proactive')).toBe(false);
  });
});

describe('isTutorTimedOut', () => {
  it('returns false for a recently started active session', () => {
    const session = makeSession('phase2');
    expect(isTutorTimedOut(session)).toBe(false);
  });

  it('returns true for a session older than TUTOR_TIMEOUT_MS', () => {
    const oldTime = new Date(Date.now() - TUTOR_TIMEOUT_MS - 1000).toISOString();
    const session = makeSession('phase2', oldTime);
    expect(isTutorTimedOut(session)).toBe(true);
  });

  it('returns false for a complete session regardless of age', () => {
    const oldTime = new Date(Date.now() - TUTOR_TIMEOUT_MS - 60000).toISOString();
    const session = makeSession('complete', oldTime);
    expect(isTutorTimedOut(session)).toBe(false);
  });

  it('returns false for an offered session regardless of age', () => {
    const oldTime = new Date(Date.now() - TUTOR_TIMEOUT_MS - 60000).toISOString();
    const session = makeSession('offered', oldTime);
    expect(isTutorTimedOut(session)).toBe(false);
  });

  it('uses lastActivityAt instead of startedAt for timeout (Issue 4)', () => {
    // Session started 31 minutes ago but lastActivityAt is 5 minutes ago
    const session = createTutorSession('test-concept', 1 as RubricScore);
    session.phase = 'phase2';
    session.startedAt = new Date(Date.now() - 31 * 60 * 1000).toISOString();
    session.lastActivityAt = new Date(Date.now() - 5 * 60 * 1000).toISOString();

    // Should NOT be timed out because last activity was recent
    expect(isTutorTimedOut(session)).toBe(false);
  });

  it('times out when lastActivityAt exceeds timeout threshold (Issue 4)', () => {
    const session = createTutorSession('test-concept', 1 as RubricScore);
    session.phase = 'phase2';
    session.startedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    session.lastActivityAt = new Date(Date.now() - 31 * 60 * 1000).toISOString();

    // Should be timed out because last activity was >30 min ago
    expect(isTutorTimedOut(session)).toBe(true);
  });

  it('falls back to startedAt when lastActivityAt is missing (Issue 4 backwards compat)', () => {
    // Simulate a legacy session without lastActivityAt
    const session = createTutorSession('test-concept', 1 as RubricScore);
    session.phase = 'phase2';
    session.startedAt = new Date(Date.now() - 31 * 60 * 1000).toISOString();
    // @ts-expect-error: simulate legacy session without lastActivityAt
    delete session.lastActivityAt;

    // Should fall back to startedAt and time out
    expect(isTutorTimedOut(session)).toBe(true);
  });
});
