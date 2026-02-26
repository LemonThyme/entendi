import { Hono } from 'hono';
import { eq, and, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  concepts, conceptEdges, userConceptStates, assessmentEvents,
  tutorSessions, tutorExchanges, probeSessions, pendingActions,
  probeTokens, dismissalEvents, responseProfiles,
} from '../db/schema.js';
import { requireAuth } from '../middleware/auth.js';
import { createProbeToken, verifyProbeToken, type ProbeToken } from '../../core/probe-token.js';
import { extractResponseFeatures, computeIntegrityScore, updateResponseProfile, type UserResponseProfile } from '../../core/response-integrity.js';
import {
  grmUpdate, grmFisherInformation, retrievability, decayPrior,
  mapRubricToFsrsGrade, fsrsStabilityAfterSuccess, fsrsDifficultyUpdate,
} from '../../core/probabilistic-model.js';
import { probeUrgency } from '../../core/probe-urgency.js';
import { propagatePrerequisiteBoost } from '../../core/prerequisite-propagation.js';
import { selectProbeCandidate } from '../../core/probe-selection.js';
import { resolveConcept } from '../lib/concept-pipeline.js';
import { resolveConceptId } from '../lib/concept-normalize.js';
import { getOrgRateLimits } from '../lib/org-rate-limits.js';
import { getOrgIntegritySettings } from '../lib/org-integrity-settings.js';
import { conceptSimilarity } from '../lib/embeddings.js';
import { pMastery, DEFAULT_GRM_PARAMS, type RubricScore, type GRMItemParams } from '../../schemas/types.js';
import type { Env } from '../index.js';
import type { Context } from 'hono';
import type { Database } from '../db/connection.js';

const PROBE_TOKEN_SECRET = process.env.BETTER_AUTH_SECRET ?? 'entendi-default-secret-change-in-production';
const PROBE_TOKEN_TTL_MS = 30 * 60 * 1000; // 30 minutes

export const mcpRoutes = new Hono<Env>();

// All MCP routes require authentication (API key or session)
mcpRoutes.use('*', requireAuth);

// --- Zod schemas for input validation ---

const observeSchema = z.object({
  concepts: z.array(z.object({
    id: z.string().min(1).max(200),
    source: z.enum(['package', 'ast', 'llm']),
  })).min(1).max(50),
  triggerContext: z.string().max(1000).default(''),
  primaryConceptId: z.string().max(200).optional(),
});

const recordEvaluationSchema = z.object({
  conceptId: z.string().min(1).max(200),
  score: z.number().int().min(0).max(3) as z.ZodType<0 | 1 | 2 | 3>,
  confidence: z.number().min(0).max(1),
  reasoning: z.string().max(2000),
  eventType: z.enum(['probe', 'tutor_phase1', 'tutor_phase4']),
  probeToken: z.object({
    tokenId: z.string(),
    userId: z.string(),
    conceptId: z.string(),
    depth: z.number(),
    evaluationCriteria: z.string(),
    issuedAt: z.string(),
    expiresAt: z.string(),
    signature: z.string(),
  }).optional(),
  responseText: z.string().min(1).max(10000).optional(),
});

const tutorStartSchema = z.object({
  conceptId: z.string().min(1).max(200),
  triggerScore: z.union([z.literal(0), z.literal(1), z.null()]).optional(),
});

const tutorAdvanceSchema = z.object({
  sessionId: z.string().uuid(),
  userResponse: z.string().min(1).max(5000),
  score: z.number().int().min(0).max(3).optional() as z.ZodType<0 | 1 | 2 | 3 | undefined>,
  confidence: z.number().min(0).max(1).optional(),
  reasoning: z.string().max(2000).optional(),
  misconception: z.string().max(1000).optional(),
});

function parseBody<T>(schema: z.ZodType<T>, body: unknown, c: Context<Env>): T | Response {
  const result = schema.safeParse(body);
  if (!result.success) {
    return c.json({ error: 'Validation error', details: result.error.issues }, 400);
  }
  return result.data;
}

// --- POST /observe ---
mcpRoutes.post('/observe', async (c) => {
  const db = c.get('db');
  const user = c.get('user')!;
  const raw = await c.req.json();
  const parsed = parseBody(observeSchema, raw, c);
  if (parsed instanceof Response) return parsed;
  const body = parsed;

  // Resolve concepts through three-tier normalization pipeline
  // Workers AI binding is available in Cloudflare Workers but not in local dev
  const ai = (c.env as any)?.AI ?? null;
  const resolvedConcepts = await Promise.all(
    body.concepts.map(async (concept) => {
      const resolved = await resolveConcept(db, concept.id, ai);
      return { ...concept, id: resolved.canonicalId, isNew: resolved.isNew };
    })
  );

  // Build probe candidates with Fisher information
  const candidates = await Promise.all(resolvedConcepts.map(async (concept) => {
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

  // Prerequisite inconsistency detection (Design Doc Section 5.5):
  // If any observed concept has higher mastery than its prerequisites,
  // add those prerequisites as probe candidates with elevated urgency.
  const INCONSISTENCY_MARGIN = 0.5; // mu difference to trigger
  const candidateIds = new Set(candidates.map(c => c.conceptId));

  for (const candidate of [...candidates]) {
    if (candidate.assessmentCount === 0) continue; // skip unassessed concepts
    // Find prerequisites of this concept
    const prereqEdges = await db.select().from(conceptEdges)
      .where(and(eq(conceptEdges.sourceId, candidate.conceptId), eq(conceptEdges.edgeType, 'requires')));

    for (const edge of prereqEdges) {
      if (candidateIds.has(edge.targetId)) continue; // already a candidate
      const [prereqState] = await db.select().from(userConceptStates)
        .where(and(eq(userConceptStates.userId, user.id), eq(userConceptStates.conceptId, edge.targetId)));

      const prereqMu = prereqState?.mu ?? 0.0;
      // Inconsistency: child has materially higher mastery than prerequisite
      if (candidate.mu - prereqMu > INCONSISTENCY_MARGIN) {
        const prereqSigma = prereqState?.sigma ?? 1.5;
        const prereqStability = prereqState?.stability ?? 1.0;
        const prereqLastAssessed = prereqState?.lastAssessed;
        const prereqDaysSince = prereqLastAssessed
          ? (Date.now() - new Date(prereqLastAssessed).getTime()) / (1000 * 60 * 60 * 24)
          : 999;
        const prereqCount = prereqState?.assessmentCount ?? 0;

        const [prereqConcept] = await db.select().from(concepts).where(eq(concepts.id, edge.targetId));
        const prereqItemParams: GRMItemParams = {
          discrimination: prereqConcept?.discrimination ?? 1.0,
          thresholds: [prereqConcept?.threshold1 ?? -1.0, prereqConcept?.threshold2 ?? 0.0, prereqConcept?.threshold3 ?? 1.0],
        };
        const prereqFisher = grmFisherInformation(prereqMu, prereqItemParams);

        // Boost urgency for inconsistent prerequisites
        const baseUrgency = probeUrgency({
          mu: prereqMu, sigma: prereqSigma, stability: prereqStability,
          daysSinceAssessed: prereqDaysSince, assessmentCount: prereqCount,
          fisherInfo: prereqFisher,
        });

        candidates.push({
          conceptId: edge.targetId,
          mu: prereqMu, sigma: prereqSigma, stability: prereqStability,
          daysSince: prereqDaysSince, lastAssessed: prereqLastAssessed ?? null,
          fisherInfo: prereqFisher,
          urgency: Math.min(1.0, baseUrgency + 0.2), // 0.2 boost for inconsistency
          itemParams: prereqItemParams,
          assessmentCount: prereqCount,
        });
        candidateIds.add(edge.targetId);
      }
    }
  }

  // Select best candidate using information-theoretic selection with conversational relevance
  const trunkId = body.primaryConceptId
    ? await resolveConceptId(db, body.primaryConceptId)
    : null;

  const similarities = new Map<string, number>();
  if (trunkId) {
    for (const c of candidates) {
      const sim = await conceptSimilarity(db, c.conceptId, trunkId);
      similarities.set(c.conceptId, sim);
    }
  }

  const selection = selectProbeCandidate(candidates, similarities, !!trunkId);
  if (!selection) {
    return c.json({ shouldProbe: false, intrusiveness: 'skip', userProfile: 'unknown' });
  }
  // Recover the full candidate (with assessmentCount, daysSince, etc.) from the candidates array
  const selected = candidates.find(c => c.conceptId === selection.selected.conceptId)!;

  // Rate limiting: check probe session (org-configurable limits)
  const orgLimits = await getOrgRateLimits(db, user.id);

  const [probeSession] = await db.select().from(probeSessions)
    .where(eq(probeSessions.userId, user.id));

  const now = Date.now();

  if (probeSession) {
    if (orgLimits.probeIntervalSeconds > 0 && probeSession.lastProbeTime &&
        (now - new Date(probeSession.lastProbeTime).getTime()) < orgLimits.probeIntervalSeconds * 1000) {
      return c.json({ shouldProbe: false, conceptId: selected.conceptId, intrusiveness: 'skip', userProfile: 'unknown' });
    }
    if (orgLimits.maxProbesPerHour > 0 && probeSession.probesThisSession >= orgLimits.maxProbesPerHour) {
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
  const masteryPct = Math.round(pMastery(selected.mu) * 100);

  // Context-aware guidance: depth probing per Design Doc Section 4.3.3
  let guidance: string;
  if (depth === 1) {
    guidance = `Ask about the core purpose and basic usage of ${concept}.`;
    if (masteryPct > 0 && masteryPct < 50) {
      guidance += ` Previous assessment suggests gaps — focus on fundamentals.`;
    }
  } else if (depth === 2) {
    guidance = `Ask about trade-offs and design decisions related to ${concept}.`;
    guidance += ` Probe why they chose it over alternatives.`;
  } else {
    guidance = `Ask about edge cases and failure modes in ${concept}.`;
    guidance += ` Ask when NOT to use it and what could break.`;
  }

  // Add trigger context to guidance so Claude can reference what the user was doing
  if (body.triggerContext) {
    guidance += ` Context: user was ${body.triggerContext}.`;
  }

  // Generate signed probe token for tamper-resistant evaluation
  const probeToken = createProbeToken({
    userId: user.id,
    conceptId: selected.conceptId,
    depth,
    evaluationCriteria: guidance,
    secret: PROBE_TOKEN_SECRET,
    ttlMs: PROBE_TOKEN_TTL_MS,
  });

  // Store token in DB for server-side validation
  await db.insert(probeTokens).values({
    id: probeToken.tokenId,
    userId: user.id,
    conceptId: selected.conceptId,
    depth,
    evaluationCriteria: guidance,
    expiresAt: new Date(probeToken.expiresAt),
    signature: probeToken.signature,
  });

  // Link token to pending action
  await db.update(pendingActions).set({
    probeTokenId: probeToken.tokenId,
  }).where(eq(pendingActions.userId, user.id));

  return c.json({
    shouldProbe: true,
    conceptId: selected.conceptId,
    depth,
    intrusiveness,
    guidance,
    userProfile,
    mastery: masteryPct,
    urgency: selected.urgency,
    probeToken,
  });
});

// --- POST /record-evaluation ---
mcpRoutes.post('/record-evaluation', async (c) => {
  const db = c.get('db');
  const user = c.get('user')!;
  const raw = await c.req.json();
  const parsed = parseBody(recordEvaluationSchema, raw, c);
  if (parsed instanceof Response) return parsed;
  const body = parsed;

  // For probe events, require a valid probe token and responseText
  let probeTokenId: string | undefined;
  let evaluationCriteria: string | undefined;
  if (body.eventType === 'probe') {
    if (!body.probeToken) {
      return c.json({ error: 'Probe token required for probe evaluations' }, 403);
    }
    if (!body.responseText) {
      return c.json({ error: 'Response text required for probe evaluations' }, 400);
    }

    // Verify cryptographic signature, expiry, userId, and conceptId
    const verification = verifyProbeToken(body.probeToken as ProbeToken, PROBE_TOKEN_SECRET, {
      userId: user.id,
      conceptId: body.conceptId,
    });
    if (!verification.valid) {
      return c.json({ error: `Invalid probe token: ${verification.reason}` }, 403);
    }

    // Check token exists in DB and hasn't been used
    const [existingToken] = await db.select().from(probeTokens)
      .where(eq(probeTokens.id, body.probeToken.tokenId));
    if (!existingToken) {
      return c.json({ error: 'Invalid probe token: not found' }, 403);
    }
    if (existingToken.usedAt) {
      return c.json({ error: 'Invalid probe token: already used' }, 403);
    }

    // Per-concept rate limit (org-configurable)
    const evalLimits = await getOrgRateLimits(db, user.id);
    if (evalLimits.probeEvalsPerConcept > 0 && evalLimits.probeEvalWindowHours > 0) {
      const windowStart = new Date(Date.now() - evalLimits.probeEvalWindowHours * 60 * 60 * 1000);
      const recentEvals = await db.select({ id: assessmentEvents.id }).from(assessmentEvents)
        .where(and(
          eq(assessmentEvents.userId, user.id),
          eq(assessmentEvents.conceptId, body.conceptId),
          eq(assessmentEvents.eventType, 'probe'),
          sql`${assessmentEvents.createdAt} > ${windowStart}`,
        )).limit(evalLimits.probeEvalsPerConcept);
      if (recentEvals.length >= evalLimits.probeEvalsPerConcept) {
        return c.json({
          error: `Rate limit: max ${evalLimits.probeEvalsPerConcept} probe evaluation(s) per concept per ${evalLimits.probeEvalWindowHours}h`,
        }, 429);
      }
    }

    // Mark token as used
    await db.update(probeTokens).set({ usedAt: new Date() })
      .where(eq(probeTokens.id, body.probeToken.tokenId));

    probeTokenId = body.probeToken.tokenId;
    evaluationCriteria = body.probeToken.evaluationCriteria;
  }

  // Response integrity analysis (only for probe events with responseText)
  let integrityScore: number | undefined;
  let integrityFlags: string[] = [];
  let responseFeatures: Record<string, unknown> | undefined;
  let dampeningThreshold: number | undefined;
  if (body.eventType === 'probe' && body.responseText && body.probeToken) {
    const responseTimeMs = Date.now() - new Date(body.probeToken.issuedAt).getTime();
    const features = extractResponseFeatures(body.responseText, responseTimeMs);
    responseFeatures = features as unknown as Record<string, unknown>;

    // Load user baseline profile
    const [profile] = await db.select().from(responseProfiles)
      .where(eq(responseProfiles.userId, user.id));
    const baseline: UserResponseProfile | undefined = profile ? {
      avgWordCount: profile.avgWordCount,
      avgCharCount: profile.avgCharCount,
      avgCharsPerSecond: profile.avgCharsPerSecond,
      avgFormattingScore: profile.avgFormattingScore,
      avgVocabComplexity: profile.avgVocabComplexity,
      sampleCount: profile.sampleCount,
    } : undefined;

    const integritySettings = await getOrgIntegritySettings(db, user.id);
    const integrity = computeIntegrityScore(features, baseline, integritySettings);
    integrityScore = integrity.score;
    integrityFlags = integrity.flags;
    dampeningThreshold = integritySettings.dampeningThreshold;

    // Update user response profile with EMA
    const updatedProfile = updateResponseProfile(baseline ?? null, features, integritySettings.emaAlpha);
    await db.insert(responseProfiles).values({
      userId: user.id,
      avgWordCount: updatedProfile.avgWordCount,
      avgCharCount: updatedProfile.avgCharCount,
      avgCharsPerSecond: updatedProfile.avgCharsPerSecond,
      avgFormattingScore: updatedProfile.avgFormattingScore,
      avgVocabComplexity: updatedProfile.avgVocabComplexity,
      sampleCount: updatedProfile.sampleCount,
    }).onConflictDoUpdate({
      target: responseProfiles.userId,
      set: {
        avgWordCount: updatedProfile.avgWordCount,
        avgCharCount: updatedProfile.avgCharCount,
        avgCharsPerSecond: updatedProfile.avgCharsPerSecond,
        avgFormattingScore: updatedProfile.avgFormattingScore,
        avgVocabComplexity: updatedProfile.avgVocabComplexity,
        sampleCount: updatedProfile.sampleCount,
        updatedAt: new Date(),
      },
    });
  }

  const result = await applyBayesianUpdateDb(db, user.id, {
    conceptId: body.conceptId,
    score: body.score,
    confidence: body.confidence,
    reasoning: body.reasoning,
    eventType: body.eventType,
    probeTokenId,
    responseText: body.responseText,
    evaluationCriteria,
    integrityScore,
    responseFeatures,
    dampeningThreshold,
  });

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
    integrityScore,
    integrityFlags: integrityFlags.length > 0 ? integrityFlags : undefined,
    message: `Mastery ${direction} from ${(result.previousMastery * 100).toFixed(1)}% to ${(result.newMastery * 100).toFixed(1)}%`,
  });
});

// --- POST /tutor/start ---
mcpRoutes.post('/tutor/start', async (c) => {
  const db = c.get('db');
  const user = c.get('user')!;
  const raw = await c.req.json();
  const parsed = parseBody(tutorStartSchema, raw, c);
  if (parsed instanceof Response) return parsed;
  const body = parsed;

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
  const raw = await c.req.json();
  const parsed = parseBody(tutorAdvanceSchema, raw, c);
  if (parsed instanceof Response) return parsed;
  const body = parsed;

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
  let integrityScore: number | undefined;
  let integrityFlags: string[] = [];
  if (isScored && body.score !== undefined) {
    const eventType = currentPhase === 'phase1' ? 'tutor_phase1' as const : 'tutor_phase4' as const;

    // Response integrity analysis for tutor responses
    let responseFeatures: Record<string, unknown> | undefined;
    let tutorDampeningThreshold: number | undefined;
    if (body.userResponse) {
      const responseTimeMs = Date.now() - new Date(session.lastActivityAt).getTime();
      const features = extractResponseFeatures(body.userResponse, responseTimeMs);
      responseFeatures = features as unknown as Record<string, unknown>;

      const [profile] = await db.select().from(responseProfiles)
        .where(eq(responseProfiles.userId, user.id));
      const baseline: UserResponseProfile | undefined = profile ? {
        avgWordCount: profile.avgWordCount,
        avgCharCount: profile.avgCharCount,
        avgCharsPerSecond: profile.avgCharsPerSecond,
        avgFormattingScore: profile.avgFormattingScore,
        avgVocabComplexity: profile.avgVocabComplexity,
        sampleCount: profile.sampleCount,
      } : undefined;

      const integritySettings = await getOrgIntegritySettings(db, user.id);
      const integrity = computeIntegrityScore(features, baseline, integritySettings);
      integrityScore = integrity.score;
      integrityFlags = integrity.flags;
      tutorDampeningThreshold = integritySettings.dampeningThreshold;

      // Update user response profile with EMA
      const updatedProfile = updateResponseProfile(baseline ?? null, features, integritySettings.emaAlpha);
      await db.insert(responseProfiles).values({
        userId: user.id,
        avgWordCount: updatedProfile.avgWordCount,
        avgCharCount: updatedProfile.avgCharCount,
        avgCharsPerSecond: updatedProfile.avgCharsPerSecond,
        avgFormattingScore: updatedProfile.avgFormattingScore,
        avgVocabComplexity: updatedProfile.avgVocabComplexity,
        sampleCount: updatedProfile.sampleCount,
      }).onConflictDoUpdate({
        target: responseProfiles.userId,
        set: {
          avgWordCount: updatedProfile.avgWordCount,
          avgCharCount: updatedProfile.avgCharCount,
          avgCharsPerSecond: updatedProfile.avgCharsPerSecond,
          avgFormattingScore: updatedProfile.avgFormattingScore,
          avgVocabComplexity: updatedProfile.avgVocabComplexity,
          sampleCount: updatedProfile.sampleCount,
          updatedAt: new Date(),
        },
      });
    }

    const result = await applyBayesianUpdateDb(db, user.id, {
      conceptId: session.conceptId,
      score: body.score,
      confidence: body.confidence ?? 0.5,
      reasoning: body.reasoning ?? '',
      eventType,
      responseText: body.userResponse,
      integrityScore,
      responseFeatures,
      dampeningThreshold: tutorDampeningThreshold,
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
      integrityScore,
      integrityFlags: integrityFlags.length > 0 ? integrityFlags : undefined,
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
    integrityScore,
    integrityFlags: integrityFlags.length > 0 ? integrityFlags : undefined,
    masteryUpdate,
  });
});

// --- POST /dismiss ---
mcpRoutes.post('/dismiss', async (c) => {
  const db = c.get('db');
  const user = c.get('user')!;

  // Read pending action before clearing, to record dismissal
  const [action] = await db.select().from(pendingActions)
    .where(eq(pendingActions.userId, user.id));

  let dismissalRecorded = false;
  if (action && action.actionType === 'awaiting_probe_response') {
    const data = action.data as { conceptId?: string };
    if (data.conceptId) {
      await db.insert(dismissalEvents).values({
        userId: user.id,
        conceptId: data.conceptId,
        probeTokenId: action.probeTokenId,
      });
      dismissalRecorded = true;
    }
  }

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

  return c.json({ acknowledged: true, dismissalRecorded });
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
  db: Database,
  userId: string,
  input: {
    conceptId: string;
    score: 0 | 1 | 2 | 3;
    confidence: number;
    reasoning: string;
    eventType: 'probe' | 'tutor_phase1' | 'tutor_phase4';
    probeTokenId?: string;
    responseText?: string;
    evaluationCriteria?: string;
    integrityScore?: number;
    responseFeatures?: Record<string, unknown>;
    dampeningThreshold?: number;
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

  // 4b. Integrity dampening — suspicious responses shouldn't move mastery much
  const dampThreshold = input.dampeningThreshold ?? 0.5;
  if (input.integrityScore !== undefined && input.integrityScore < dampThreshold) {
    const dampFactor = input.integrityScore;
    newMu = currentMu + dampFactor * (newMu - currentMu);
    newSigma = currentSigma + dampFactor * (newSigma - currentSigma);
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
    probeTokenId: input.probeTokenId,
    responseText: input.responseText,
    evaluationCriteria: input.evaluationCriteria,
    responseFeatures: input.responseFeatures,
    integrityScore: input.integrityScore,
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
