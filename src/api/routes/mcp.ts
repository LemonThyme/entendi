import { Hono } from 'hono';
import { eq, and, sql } from 'drizzle-orm';
import {
  concepts, conceptEdges, userConceptStates, assessmentEvents,
  tutorSessions, tutorExchanges, probeSessions, pendingActions,
} from '../db/schema.js';
import { requireAuth } from '../middleware/auth.js';
import {
  grmUpdate, grmFisherInformation, retrievability, decayPrior,
  mapRubricToFsrsGrade, fsrsStabilityAfterSuccess, fsrsDifficultyUpdate,
} from '../../core/probabilistic-model.js';
import { probeUrgency } from '../../core/probe-urgency.js';
import { propagatePrerequisiteBoost } from '../../core/prerequisite-propagation.js';
import { pMastery, DEFAULT_GRM_PARAMS, type RubricScore, type GRMItemParams } from '../../schemas/types.js';
import type { Env } from '../index.js';

export const mcpRoutes = new Hono<Env>();

// All MCP routes require authentication (API key or session)
mcpRoutes.use('*', requireAuth);

// --- POST /observe ---
mcpRoutes.post('/observe', async (c) => {
  const db = c.get('db');
  const user = c.get('user')!;
  const body = await c.req.json<{
    concepts: Array<{ id: string; source: 'package' | 'ast' | 'llm' }>;
    triggerContext: string;
  }>();

  // Ensure all concepts exist
  for (const concept of body.concepts) {
    const existing = await db.select({ id: concepts.id }).from(concepts)
      .where(eq(concepts.id, concept.id)).limit(1);
    if (existing.length === 0) {
      await db.insert(concepts).values({
        id: concept.id,
        domain: 'general',
        specificity: 'topic',
      });
    }
  }

  // Build probe candidates with Fisher information
  const candidates = await Promise.all(body.concepts.map(async (concept) => {
    const [ucs] = await db.select().from(userConceptStates)
      .where(and(eq(userConceptStates.userId, user.id), eq(userConceptStates.conceptId, concept.id)));
    const [conceptRow] = await db.select().from(concepts).where(eq(concepts.id, concept.id));

    const mu = ucs?.mu ?? 0.0;
    const sigma = ucs?.sigma ?? 1.5;
    const stability = ucs?.stability ?? 1.0;
    const lastAssessed = ucs?.lastAssessed;
    const daysSince = lastAssessed
      ? (Date.now() - new Date(lastAssessed).getTime()) / (1000 * 60 * 60 * 24)
      : 999;

    const itemParams: GRMItemParams = {
      discrimination: conceptRow?.discrimination ?? 1.0,
      thresholds: [conceptRow?.threshold1 ?? -1.0, conceptRow?.threshold2 ?? 0.0, conceptRow?.threshold3 ?? 1.0],
    };

    const fisherInfo = grmFisherInformation(mu, itemParams);

    return {
      conceptId: concept.id,
      mu, sigma, stability, daysSince, lastAssessed,
      fisherInfo,
      urgency: probeUrgency({
        mu, sigma, stability,
        daysSinceAssessed: daysSince,
        assessmentCount: ucs?.assessmentCount ?? 0,
        fisherInfo,
      }),
      itemParams,
      assessmentCount: ucs?.assessmentCount ?? 0,
    };
  }));

  // Select best candidate by probe urgency (combines mastery gap, uncertainty, and decay)
  const sorted = candidates.sort((a, b) => b.urgency - a.urgency);
  const selected = sorted[0];
  if (!selected) {
    return c.json({ shouldProbe: false, intrusiveness: 'skip', userProfile: 'unknown' });
  }

  // Rate limiting: check probe session
  const [probeSession] = await db.select().from(probeSessions)
    .where(eq(probeSessions.userId, user.id));

  const now = Date.now();
  const minIntervalMs = 2 * 60 * 1000; // 2 minutes
  const maxProbesPerHour = 15;

  if (probeSession) {
    if (probeSession.lastProbeTime && (now - new Date(probeSession.lastProbeTime).getTime()) < minIntervalMs) {
      return c.json({ shouldProbe: false, conceptId: selected.conceptId, intrusiveness: 'skip', userProfile: 'unknown' });
    }
    if (probeSession.probesThisSession >= maxProbesPerHour) {
      return c.json({ shouldProbe: false, conceptId: selected.conceptId, intrusiveness: 'skip', userProfile: 'unknown' });
    }
  }

  // Compute user profile
  const allStates = await db.select().from(userConceptStates)
    .where(eq(userConceptStates.userId, user.id));
  const assessed = allStates.filter(s => s.assessmentCount > 0);
  let userProfile: 'unknown' | 'beginner' | 'intermediate' | 'advanced' = 'unknown';
  if (assessed.length > 0) {
    const avg = assessed.reduce((sum, s) => sum + pMastery(s.mu), 0) / assessed.length;
    if (avg > 0.75) userProfile = 'advanced';
    else if (avg > 0.4) userProfile = 'intermediate';
    else userProfile = 'beginner';
  }

  // Intrusiveness mapping
  const novelty = selected.assessmentCount === 0 ? 'novel' : selected.daysSince > 30 ? 'novel' : 'adjacent';
  const intrusMap: Record<string, Record<string, string>> = {
    unknown: { novel: 'direct', adjacent: 'direct', routine: 'skip' },
    beginner: { novel: 'direct', adjacent: 'woven', routine: 'skip' },
    intermediate: { novel: 'woven', adjacent: 'woven', routine: 'skip' },
    advanced: { novel: 'woven', adjacent: 'skip', routine: 'skip' },
  };
  const intrusiveness = intrusMap[userProfile]?.[novelty] ?? 'skip';

  if (intrusiveness === 'skip') {
    return c.json({ shouldProbe: false, conceptId: selected.conceptId, intrusiveness: 'skip', userProfile });
  }

  // Determine depth from novelty
  const depth = novelty === 'novel' ? 1 : novelty === 'adjacent' ? 2 : 3;

  // Update probe session
  await db.insert(probeSessions).values({
    userId: user.id,
    pendingConceptId: selected.conceptId,
    lastProbeTime: new Date(),
    probesThisSession: 1,
  }).onConflictDoUpdate({
    target: probeSessions.userId,
    set: {
      pendingConceptId: selected.conceptId,
      lastProbeTime: new Date(),
      probesThisSession: sql`${probeSessions.probesThisSession} + 1`,
    },
  });

  // Write pending action
  await db.insert(pendingActions).values({
    userId: user.id,
    actionType: 'awaiting_probe_response',
    data: { conceptId: selected.conceptId, depth, timestamp: new Date().toISOString() },
  }).onConflictDoUpdate({
    target: pendingActions.userId,
    set: {
      actionType: 'awaiting_probe_response',
      data: { conceptId: selected.conceptId, depth, timestamp: new Date().toISOString() },
      createdAt: new Date(),
    },
  });

  const concept = selected.conceptId.replace(/\//g, ' ').replace(/-/g, ' ');
  const guidance = depth === 1
    ? `Ask about the core purpose and basic usage of ${concept}`
    : depth === 2
    ? `Ask about trade-offs and design decisions related to ${concept}`
    : `Ask about edge cases and failure modes in ${concept}`;

  return c.json({
    shouldProbe: true,
    conceptId: selected.conceptId,
    depth,
    intrusiveness,
    guidance,
    userProfile,
  });
});

// --- POST /record-evaluation ---
mcpRoutes.post('/record-evaluation', async (c) => {
  const db = c.get('db');
  const user = c.get('user')!;
  const body = await c.req.json<{
    conceptId: string;
    score: 0 | 1 | 2 | 3;
    confidence: number;
    reasoning: string;
    eventType: 'probe' | 'tutor_phase1' | 'tutor_phase4';
  }>();

  const result = await applyBayesianUpdateDb(db, user.id, body);

  // Clear pending action
  await db.delete(pendingActions).where(eq(pendingActions.userId, user.id));

  // Check if tutor should be offered (only for probe events)
  let shouldOfferTutor = false;
  if (body.eventType === 'probe' && body.score <= 1) {
    shouldOfferTutor = true;

    // Write tutor_offered pending action
    await db.insert(pendingActions).values({
      userId: user.id,
      actionType: 'tutor_offered',
      data: { conceptId: body.conceptId, triggerScore: body.score, timestamp: new Date().toISOString() },
    }).onConflictDoUpdate({
      target: pendingActions.userId,
      set: {
        actionType: 'tutor_offered',
        data: { conceptId: body.conceptId, triggerScore: body.score, timestamp: new Date().toISOString() },
      },
    });
  }

  const direction = result.newMastery > result.previousMastery ? 'improved'
    : result.newMastery < result.previousMastery ? 'decreased' : 'unchanged';

  return c.json({
    mastery: result.newMastery,
    previousMastery: result.previousMastery,
    sigma: result.newSigma,
    previousSigma: result.previousSigma,
    shouldOfferTutor,
    message: `Mastery ${direction} from ${(result.previousMastery * 100).toFixed(1)}% to ${(result.newMastery * 100).toFixed(1)}%`,
  });
});

// --- POST /tutor/start ---
mcpRoutes.post('/tutor/start', async (c) => {
  const db = c.get('db');
  const user = c.get('user')!;
  const body = await c.req.json<{ conceptId: string; triggerScore?: 0 | 1 | null }>();

  const sessionId = crypto.randomUUID();

  // Create tutor session
  await db.insert(tutorSessions).values({
    id: sessionId,
    userId: user.id,
    conceptId: body.conceptId,
    phase: 'phase1',
    triggerScore: body.triggerScore !== null && body.triggerScore !== undefined
      ? body.triggerScore : null,
  });

  // Check prerequisites
  const prereqEdges = await db.select().from(conceptEdges)
    .where(and(eq(conceptEdges.sourceId, body.conceptId), eq(conceptEdges.edgeType, 'requires')));

  let prerequisiteSuggestion: string | undefined;
  if (prereqEdges.length > 0) {
    const unmasteredPrereqs: string[] = [];
    for (const edge of prereqEdges) {
      const [ucs] = await db.select().from(userConceptStates)
        .where(and(eq(userConceptStates.userId, user.id), eq(userConceptStates.conceptId, edge.targetId)));
      if (!ucs || pMastery(ucs.mu) < 0.7) {
        unmasteredPrereqs.push(edge.targetId);
      }
    }
    if (unmasteredPrereqs.length > 0) {
      prerequisiteSuggestion = `Consider teaching ${unmasteredPrereqs.join(', ')} first — these prerequisites are not yet mastered.`;
    }
  }

  // Write pending action
  await db.insert(pendingActions).values({
    userId: user.id,
    actionType: 'tutor_active',
    data: { sessionId, conceptId: body.conceptId, phase: 'phase1', timestamp: new Date().toISOString() },
  }).onConflictDoUpdate({
    target: pendingActions.userId,
    set: {
      actionType: 'tutor_active',
      data: { sessionId, conceptId: body.conceptId, phase: 'phase1', timestamp: new Date().toISOString() },
    },
  });

  return c.json({
    sessionId,
    phase: 'phase1',
    guidance: `Assess what the user already knows about ${body.conceptId}. Ask an open-ended question about their understanding.`,
    ...(prerequisiteSuggestion && { prerequisiteSuggestion }),
  });
});

// --- POST /tutor/advance ---
mcpRoutes.post('/tutor/advance', async (c) => {
  const db = c.get('db');
  const user = c.get('user')!;
  const body = await c.req.json<{
    sessionId: string;
    userResponse: string;
    score?: 0 | 1 | 2 | 3;
    confidence?: number;
    reasoning?: string;
    misconception?: string;
  }>();

  // Load session
  const [session] = await db.select().from(tutorSessions)
    .where(and(eq(tutorSessions.id, body.sessionId), eq(tutorSessions.userId, user.id)));
  if (!session) {
    return c.json({ error: `No active tutor session with id ${body.sessionId}` }, 404);
  }

  const currentPhase = session.phase;
  let masteryUpdate: { before: number; after: number } | undefined;

  // Record exchange
  await db.insert(tutorExchanges).values({
    sessionId: body.sessionId,
    phase: currentPhase,
    question: '', // The question was already generated in guidance
    response: body.userResponse,
  });

  // Bayesian update at scored phases (phase1, phase4)
  const isScored = currentPhase === 'phase1' || currentPhase === 'phase4';
  if (isScored && body.score !== undefined) {
    const eventType = currentPhase === 'phase1' ? 'tutor_phase1' as const : 'tutor_phase4' as const;
    const result = await applyBayesianUpdateDb(db, user.id, {
      conceptId: session.conceptId,
      score: body.score,
      confidence: body.confidence ?? 0.5,
      reasoning: body.reasoning ?? '',
      eventType,
    });
    masteryUpdate = { before: result.previousMastery, after: result.newMastery };

    // Update phase scores
    if (currentPhase === 'phase1') {
      await db.update(tutorSessions).set({ phase1Score: body.score }).where(eq(tutorSessions.id, body.sessionId));
    } else if (currentPhase === 'phase4') {
      await db.update(tutorSessions).set({ phase4Score: body.score }).where(eq(tutorSessions.id, body.sessionId));
    }
  }

  // Store misconception
  if (body.misconception) {
    await db.update(tutorSessions).set({ lastMisconception: body.misconception }).where(eq(tutorSessions.id, body.sessionId));
  }

  // Advance phase
  const phaseOrder = ['phase1', 'phase2', 'phase3', 'phase4', 'complete'];
  const currentIdx = phaseOrder.indexOf(currentPhase);
  const nextPhase = phaseOrder[currentIdx + 1] || 'complete';

  // Update session
  await db.update(tutorSessions).set({
    phase: nextPhase,
    lastActivityAt: new Date(),
  }).where(eq(tutorSessions.id, body.sessionId));

  if (nextPhase === 'complete') {
    // Reload session for summary
    const [final] = await db.select().from(tutorSessions).where(eq(tutorSessions.id, body.sessionId));
    const p1 = final?.phase1Score ?? 'N/A';
    const p4 = final?.phase4Score ?? 'N/A';
    const masteryStr = masteryUpdate
      ? ` Mastery changed from ${(masteryUpdate.before * 100).toFixed(1)}% to ${(masteryUpdate.after * 100).toFixed(1)}%.`
      : '';

    // Clear pending action
    await db.delete(pendingActions).where(eq(pendingActions.userId, user.id));

    return c.json({
      phase: 'complete',
      isComplete: true,
      sessionSummary: `Tutor session for ${session.conceptId} complete. Phase 1 score: ${p1}/3, Phase 4 score: ${p4}/3.${masteryStr}`,
      masteryUpdate,
    });
  }

  // Generate guidance for next phase
  const guidanceMap: Record<string, string> = {
    phase1: `Assess what the user already knows about ${session.conceptId}. Ask an open-ended question about their understanding.`,
    phase2: `Guide them toward deeper understanding of ${session.conceptId}. Identify gaps from their phase1 answer.`,
    phase3: body.misconception
      ? `Address the misconception: "${body.misconception}". Help the user correct their understanding of ${session.conceptId}.`
      : `Deepen understanding of ${session.conceptId}. Address any remaining gaps or misconceptions.`,
    phase4: `Ask for a comprehensive explanation of ${session.conceptId}. This is the final assessment.`,
  };

  // Update pending action
  await db.insert(pendingActions).values({
    userId: user.id,
    actionType: 'tutor_active',
    data: { sessionId: body.sessionId, conceptId: session.conceptId, phase: nextPhase, timestamp: new Date().toISOString() },
  }).onConflictDoUpdate({
    target: pendingActions.userId,
    set: {
      actionType: 'tutor_active',
      data: { sessionId: body.sessionId, conceptId: session.conceptId, phase: nextPhase, timestamp: new Date().toISOString() },
    },
  });

  return c.json({
    phase: nextPhase,
    isComplete: false,
    guidance: guidanceMap[nextPhase] || '',
    masteryUpdate,
  });
});

// --- POST /dismiss ---
mcpRoutes.post('/dismiss', async (c) => {
  const db = c.get('db');
  const user = c.get('user')!;

  // Clear probe session
  await db.update(probeSessions).set({
    pendingConceptId: null,
    pendingProbeData: null,
  }).where(eq(probeSessions.userId, user.id));

  // Clear any active tutor sessions (mark complete)
  await db.update(tutorSessions).set({ phase: 'complete' })
    .where(and(
      eq(tutorSessions.userId, user.id),
      sql`${tutorSessions.phase} != 'complete'`,
    ));

  // Clear pending action
  await db.delete(pendingActions).where(eq(pendingActions.userId, user.id));

  return c.json({ acknowledged: true });
});

// --- GET /status ---
mcpRoutes.get('/status', async (c) => {
  const db = c.get('db');
  const user = c.get('user')!;
  const conceptId = c.req.query('conceptId');

  if (conceptId) {
    const [ucs] = await db.select().from(userConceptStates)
      .where(and(eq(userConceptStates.userId, user.id), eq(userConceptStates.conceptId, conceptId)));

    const mu = ucs?.mu ?? 0;
    const sigma = ucs?.sigma ?? 1.5;
    const stability = ucs?.stability ?? 1.0;
    const lastAssessedTs = ucs?.lastAssessed;
    const daysSince = lastAssessedTs
      ? (Date.now() - new Date(lastAssessedTs).getTime()) / (1000 * 60 * 60 * 24)
      : 999;
    const count = ucs?.assessmentCount ?? 0;

    // Classify confidence level from sigma
    let confidenceLevel: 'high' | 'medium' | 'low' | 'none';
    if (count === 0) confidenceLevel = 'none';
    else if (sigma < 0.4) confidenceLevel = 'high';
    else if (sigma < 0.8) confidenceLevel = 'medium';
    else confidenceLevel = 'low';

    return c.json({
      concept: {
        mastery: pMastery(mu),
        sigma,
        posteriorVariance: sigma * sigma,
        confidenceLevel,
        assessmentCount: count,
        lastAssessed: lastAssessedTs ?? null,
        tutoredCount: ucs?.tutoredCount ?? 0,
        untutoredCount: ucs?.untutoredCount ?? 0,
        urgency: probeUrgency({
          mu, sigma, stability,
          daysSinceAssessed: daysSince,
          assessmentCount: count,
          fisherInfo: 0, // not needed for display
        }),
      },
    });
  }

  // Overview
  const allConcepts = await db.select({ id: concepts.id }).from(concepts);
  const allStates = await db.select().from(userConceptStates)
    .where(eq(userConceptStates.userId, user.id));

  let mastered = 0, inProgress = 0;
  const recentActivity: string[] = [];

  for (const state of allStates) {
    if (pMastery(state.mu) >= 0.7) mastered++;
    else if (state.assessmentCount > 0) inProgress++;

    if (state.lastAssessed) {
      recentActivity.push(`${state.conceptId} (${new Date(state.lastAssessed).toISOString()})`);
    }
  }

  recentActivity.sort().reverse();

  return c.json({
    overview: {
      totalConcepts: allConcepts.length,
      mastered,
      inProgress,
      unknown: allConcepts.length - mastered - inProgress,
      recentActivity: recentActivity.slice(0, 5),
    },
  });
});

// --- GET /zpd-frontier ---
mcpRoutes.get('/zpd-frontier', async (c) => {
  const db = c.get('db');
  const user = c.get('user')!;

  const result = await db.execute(sql`
    SELECT c.id, c.domain, c.specificity,
           COALESCE(ucs.mu, 0) AS mu,
           COALESCE(ucs.sigma, 1.5) AS sigma,
           c.discrimination, c.threshold_1, c.threshold_2, c.threshold_3
    FROM concepts c
    LEFT JOIN user_concept_states ucs ON ucs.concept_id = c.id AND ucs.user_id = ${user.id}
    WHERE (1.0 / (1.0 + EXP(-COALESCE(ucs.mu, 0)))) < 0.7
      AND NOT EXISTS (
        SELECT 1 FROM concept_edges ce
        LEFT JOIN user_concept_states pucs ON pucs.concept_id = ce.target_id AND pucs.user_id = ${user.id}
        WHERE ce.source_id = c.id
          AND ce.edge_type = 'requires'
          AND (1.0 / (1.0 + EXP(-COALESCE(pucs.mu, 0)))) < 0.7
      )
    ORDER BY c.id
  `);

  const frontier = (result.rows as any[]).map(row => ({
    conceptId: row.id,
    mastery: pMastery(Number(row.mu)),
    fisherInfo: grmFisherInformation(Number(row.mu), {
      discrimination: row.discrimination ?? 1.0,
      thresholds: [row.threshold_1 ?? -1.0, row.threshold_2 ?? 0.0, row.threshold_3 ?? 1.0],
    }),
  }));

  // Sort by Fisher info descending
  frontier.sort((a, b) => b.fisherInfo - a.fisherInfo);

  const allCount = await db.select({ id: concepts.id }).from(concepts);
  const masteredStates = await db.select().from(userConceptStates)
    .where(eq(userConceptStates.userId, user.id));
  const masteredCount = masteredStates.filter(s => pMastery(s.mu) >= 0.7).length;

  return c.json({ frontier, totalConcepts: allCount.length, masteredCount });
});

// --- GET /pending-action — check for pending action (used by hooks) ---
mcpRoutes.get('/pending-action', async (c) => {
  const db = c.get('db');
  const user = c.get('user')!;

  const [action] = await db.select().from(pendingActions)
    .where(eq(pendingActions.userId, user.id));

  if (!action) return c.json({ pending: null });

  return c.json({
    pending: {
      type: action.actionType,
      ...(action.data as Record<string, unknown>),
    },
  });
});

// --- Shared: Bayesian update against DB ---

async function applyBayesianUpdateDb(
  db: any,
  userId: string,
  input: {
    conceptId: string;
    score: 0 | 1 | 2 | 3;
    confidence: number;
    reasoning: string;
    eventType: 'probe' | 'tutor_phase1' | 'tutor_phase4';
  },
) {
  const { conceptId, score, confidence, eventType } = input;

  // Load current state
  const [ucs] = await db.select().from(userConceptStates)
    .where(and(eq(userConceptStates.userId, userId), eq(userConceptStates.conceptId, conceptId)));

  const mu = ucs?.mu ?? 0.0;
  const sigma = ucs?.sigma ?? 1.5;
  const stability = ucs?.stability ?? 1.0;
  const difficulty = ucs?.difficulty ?? 5.0;
  const lastAssessed = ucs?.lastAssessed;
  const assessmentCount = ucs?.assessmentCount ?? 0;
  const tutoredCount = ucs?.tutoredCount ?? 0;
  const untutoredCount = ucs?.untutoredCount ?? 0;
  const muUntutored = ucs?.muUntutored ?? 0.0;
  const sigmaUntutored = ucs?.sigmaUntutored ?? 1.5;

  const previousMastery = pMastery(mu);
  const previousSigma = sigma;

  // Load concept item params
  const [conceptRow] = await db.select().from(concepts).where(eq(concepts.id, conceptId));
  const itemParams: GRMItemParams = {
    discrimination: conceptRow?.discrimination ?? 1.0,
    thresholds: [conceptRow?.threshold1 ?? -1.0, conceptRow?.threshold2 ?? 0.0, conceptRow?.threshold3 ?? 1.0],
  };

  // 1. Time decay
  let currentMu = mu;
  let currentSigma = sigma;
  let R = 1.0;
  if (lastAssessed) {
    const elapsedDays = (Date.now() - new Date(lastAssessed).getTime()) / (1000 * 60 * 60 * 24);
    R = retrievability(elapsedDays, stability);
    const decayed = decayPrior(mu, sigma, R);
    currentMu = decayed.mu;
    currentSigma = decayed.sigma;
  }

  // 2. GRM update
  const muBefore = currentMu;
  const updated = grmUpdate({ mu: currentMu, sigma: currentSigma }, score as RubricScore, itemParams);

  // 3. FSRS update
  const fsrsGrade = mapRubricToFsrsGrade(score as RubricScore);
  let newStability = stability;
  let newDifficulty = difficulty;
  if (fsrsGrade >= 2) {
    newStability = fsrsStabilityAfterSuccess(stability, difficulty, R, fsrsGrade);
  }
  newDifficulty = fsrsDifficultyUpdate(difficulty, fsrsGrade);

  // 4. Counterfactual tracking
  const isTutored = eventType === 'tutor_phase4';
  const tutoredWeight = 0.5; // default tutoredEvidenceWeight
  let newMu: number, newSigma: number;
  let newMuUntutored = muUntutored;
  let newSigmaUntutored = sigmaUntutored;
  let newTutoredCount = tutoredCount;
  let newUntutoredCount = untutoredCount;

  if (isTutored) {
    newMu = currentMu + tutoredWeight * (updated.mu - currentMu);
    newSigma = currentSigma + tutoredWeight * (updated.sigma - currentSigma);
    newTutoredCount += 1;
  } else {
    newMu = updated.mu;
    newSigma = updated.sigma;
    newMuUntutored = updated.mu;
    newSigmaUntutored = updated.sigma;
    newUntutoredCount += 1;
  }

  // 5. Record assessment event
  const probeDepth = eventType === 'probe' ? 1 : eventType === 'tutor_phase1' ? 1 : 3;
  await db.insert(assessmentEvents).values({
    userId,
    conceptId,
    eventType,
    rubricScore: score,
    evaluatorConfidence: confidence,
    muBefore,
    muAfter: newMu,
    probeDepth,
    tutored: isTutored,
  });

  // 6. Upsert user concept state
  const now = new Date();
  if (ucs) {
    await db.update(userConceptStates).set({
      mu: newMu,
      sigma: newSigma,
      stability: newStability,
      difficulty: newDifficulty,
      lastAssessed: now,
      assessmentCount: assessmentCount + 1,
      tutoredCount: newTutoredCount,
      untutoredCount: newUntutoredCount,
      muUntutored: newMuUntutored,
      sigmaUntutored: newSigmaUntutored,
      updatedAt: now,
    }).where(and(
      eq(userConceptStates.userId, userId),
      eq(userConceptStates.conceptId, conceptId),
    ));
  } else {
    await db.insert(userConceptStates).values({
      userId,
      conceptId,
      mu: newMu,
      sigma: newSigma,
      stability: newStability,
      difficulty: newDifficulty,
      lastAssessed: now,
      assessmentCount: 1,
      tutoredCount: newTutoredCount,
      untutoredCount: newUntutoredCount,
      muUntutored: newMuUntutored,
      sigmaUntutored: newSigmaUntutored,
    });
  }

  const newMastery = pMastery(newMu);

  // 7. Prerequisite propagation (Design Doc Section 5.5)
  // When mastery of concept c improves, boost dependents that REQUIRE c
  const dependentEdges = await db.select().from(conceptEdges)
    .where(and(eq(conceptEdges.targetId, conceptId), eq(conceptEdges.edgeType, 'requires')));

  if (dependentEdges.length > 0 && newMu > muBefore) {
    const targets = await Promise.all(dependentEdges.map(async (edge: { sourceId: string; targetId: string; edgeType: string }) => {
      const [depState] = await db.select().from(userConceptStates)
        .where(and(eq(userConceptStates.userId, userId), eq(userConceptStates.conceptId, edge.sourceId)));
      return {
        conceptId: edge.sourceId,
        mu: depState?.mu ?? 0.0,
        sigma: depState?.sigma ?? 1.5,
      };
    }));

    const boosts = propagatePrerequisiteBoost({ muBefore, muAfter: newMu, targets });
    for (const boost of boosts) {
      const [existing] = await db.select().from(userConceptStates)
        .where(and(eq(userConceptStates.userId, userId), eq(userConceptStates.conceptId, boost.conceptId)));
      if (existing) {
        await db.update(userConceptStates).set({
          mu: boost.newMu,
          updatedAt: now,
        }).where(and(
          eq(userConceptStates.userId, userId),
          eq(userConceptStates.conceptId, boost.conceptId),
        ));
      }
      // Don't create new state rows — only boost existing ones
    }
  }

  return { previousMastery, newMastery, previousSigma, newSigma: newSigma };
}
