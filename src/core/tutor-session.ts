import type { TutorSession, TutorPhase, RubricScore } from '../schemas/types.js';
import type { OrgPolicy } from '../config/org-policy.js';

export const TUTOR_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

const PHASE_ORDER: TutorPhase[] = ['offered', 'phase1', 'phase2', 'phase3', 'phase4', 'complete'];

export function advanceTutorPhase(session: TutorSession): TutorSession {
  const idx = PHASE_ORDER.indexOf(session.phase);
  if (idx < 0 || idx >= PHASE_ORDER.length - 1) return session;
  return { ...session, phase: PHASE_ORDER[idx + 1] };
}

export function isTutorActive(session: TutorSession | null): boolean {
  if (!session) return false;
  return session.phase !== 'offered' && session.phase !== 'complete';
}

export function isTutorOffered(session: TutorSession | null): boolean {
  if (!session) return false;
  return session.phase === 'offered';
}

export function isPhaseScored(phase: TutorPhase): boolean {
  return phase === 'phase1' || phase === 'phase4';
}

export function shouldOfferTutor(
  probeScore: RubricScore,
  threshold: RubricScore,
  tutorMode: OrgPolicy['tutorMode'],
): boolean {
  if (tutorMode === 'off' || tutorMode === 'proactive') return false;
  return probeScore <= threshold;
}

export function isTutorTimedOut(session: TutorSession): boolean {
  if (session.phase === 'complete' || session.phase === 'offered') return false;
  const elapsed = Date.now() - new Date(session.startedAt).getTime();
  return elapsed > TUTOR_TIMEOUT_MS;
}
