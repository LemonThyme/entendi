import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StateManager } from '../../../src/core/state-manager.js';
import {
  handleGetStatus,
  handleGetZPDFrontier,
} from '../../../src/mcp/tools/query.js';
import { createConceptNode, pMastery } from '../../../src/schemas/types.js';

describe('entendi_get_status', () => {
  let dataDir: string;
  let sm: StateManager;
  const userId = 'test-user';

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'entendi-status-'));
    sm = new StateManager(dataDir, userId);
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('returns overview when no conceptId provided', () => {
    // Add some concepts
    const kg = sm.getKnowledgeGraph();
    kg.addConcept(createConceptNode({
      conceptId: 'redis/caching',
      domain: 'databases',
      specificity: 'topic',
    }));
    kg.addConcept(createConceptNode({
      conceptId: 'express/middleware',
      domain: 'web',
      specificity: 'topic',
    }));
    sm.save();
    sm = new StateManager(dataDir, userId);

    const result = handleGetStatus({}, sm, userId);
    expect(result.overview).toBeDefined();
    expect(result.overview!.totalConcepts).toBe(2);
    expect(result.concept).toBeUndefined();
  });

  it('returns concept detail when conceptId provided', () => {
    const kg = sm.getKnowledgeGraph();
    kg.addConcept(createConceptNode({
      conceptId: 'redis/caching',
      domain: 'databases',
      specificity: 'topic',
    }));
    // Add an assessment
    const ucs = kg.getUserConceptState(userId, 'redis/caching');
    ucs.mastery = { mu: 1.5, sigma: 0.8 };
    ucs.assessmentCount = 3;
    ucs.lastAssessed = '2026-02-25T12:00:00.000Z';
    ucs.tutoredAssessmentCount = 1;
    ucs.untutoredAssessmentCount = 2;
    kg.setUserConceptState(userId, 'redis/caching', ucs);
    sm.save();
    sm = new StateManager(dataDir, userId);

    const result = handleGetStatus({ conceptId: 'redis/caching' }, sm, userId);
    expect(result.concept).toBeDefined();
    expect(result.concept!.mastery).toBeCloseTo(pMastery(1.5), 2);
    expect(result.concept!.sigma).toBeCloseTo(0.8, 2);
    expect(result.concept!.assessmentCount).toBe(3);
    expect(result.concept!.tutoredCount).toBe(1);
    expect(result.concept!.untutoredCount).toBe(2);
    expect(result.overview).toBeUndefined();
  });

  it('overview categorizes concepts as mastered, inProgress, unknown', () => {
    const kg = sm.getKnowledgeGraph();
    // Mastered concept
    kg.addConcept(createConceptNode({ conceptId: 'mastered', domain: 'test', specificity: 'topic' }));
    const masteredUcs = kg.getUserConceptState(userId, 'mastered');
    masteredUcs.mastery = { mu: 3.0, sigma: 0.3 };
    masteredUcs.assessmentCount = 5;
    kg.setUserConceptState(userId, 'mastered', masteredUcs);

    // In-progress concept
    kg.addConcept(createConceptNode({ conceptId: 'in-progress', domain: 'test', specificity: 'topic' }));
    const ipUcs = kg.getUserConceptState(userId, 'in-progress');
    ipUcs.mastery = { mu: 0.5, sigma: 0.8 };
    ipUcs.assessmentCount = 2;
    kg.setUserConceptState(userId, 'in-progress', ipUcs);

    // Unknown concept (never assessed)
    kg.addConcept(createConceptNode({ conceptId: 'unknown', domain: 'test', specificity: 'topic' }));

    sm.save();
    sm = new StateManager(dataDir, userId);

    const result = handleGetStatus({}, sm, userId);
    expect(result.overview!.totalConcepts).toBe(3);
    expect(result.overview!.mastered).toBe(1);
    expect(result.overview!.inProgress).toBe(1);
    expect(result.overview!.unknown).toBe(1);
  });

  it('returns empty overview when no concepts exist', () => {
    const result = handleGetStatus({}, sm, userId);
    expect(result.overview!.totalConcepts).toBe(0);
    expect(result.overview!.mastered).toBe(0);
    expect(result.overview!.inProgress).toBe(0);
    expect(result.overview!.unknown).toBe(0);
  });

  it('returns defaults for unknown concept', () => {
    const result = handleGetStatus({ conceptId: 'nonexistent' }, sm, userId);
    expect(result.concept).toBeDefined();
    expect(result.concept!.mastery).toBeCloseTo(pMastery(0.0), 2);
    expect(result.concept!.sigma).toBeCloseTo(1.5, 2);
    expect(result.concept!.assessmentCount).toBe(0);
    expect(result.concept!.lastAssessed).toBeNull();
    expect(result.concept!.tutoredCount).toBe(0);
    expect(result.concept!.untutoredCount).toBe(0);
  });

  it('overview includes recent activity from assessed concepts', () => {
    const kg = sm.getKnowledgeGraph();
    kg.addConcept(createConceptNode({ conceptId: 'concept-a', domain: 'test', specificity: 'topic' }));
    const ucsA = kg.getUserConceptState(userId, 'concept-a');
    ucsA.assessmentCount = 1;
    ucsA.lastAssessed = '2026-02-25T10:00:00.000Z';
    kg.setUserConceptState(userId, 'concept-a', ucsA);

    kg.addConcept(createConceptNode({ conceptId: 'concept-b', domain: 'test', specificity: 'topic' }));
    const ucsB = kg.getUserConceptState(userId, 'concept-b');
    ucsB.assessmentCount = 1;
    ucsB.lastAssessed = '2026-02-25T12:00:00.000Z';
    kg.setUserConceptState(userId, 'concept-b', ucsB);

    sm.save();
    sm = new StateManager(dataDir, userId);

    const result = handleGetStatus({}, sm, userId);
    expect(result.overview!.recentActivity.length).toBe(2);
    // Most recent first
    expect(result.overview!.recentActivity[0]).toContain('concept-b');
    expect(result.overview!.recentActivity[1]).toContain('concept-a');
  });
});

describe('entendi_get_zpd_frontier', () => {
  let dataDir: string;
  let sm: StateManager;
  const userId = 'test-user';

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'entendi-zpd-'));
    sm = new StateManager(dataDir, userId);
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('returns frontier concepts ready to learn', () => {
    const kg = sm.getKnowledgeGraph();
    // Concept with no prerequisites and low mastery -> in frontier
    kg.addConcept(createConceptNode({ conceptId: 'basics', domain: 'test', specificity: 'topic' }));
    // Mastered concept -> not in frontier
    kg.addConcept(createConceptNode({ conceptId: 'mastered', domain: 'test', specificity: 'topic' }));
    const ucs = kg.getUserConceptState(userId, 'mastered');
    ucs.mastery = { mu: 3.0, sigma: 0.3 };
    ucs.assessmentCount = 5;
    kg.setUserConceptState(userId, 'mastered', ucs);

    sm.save();
    sm = new StateManager(dataDir, userId);

    const result = handleGetZPDFrontier(sm, userId, { includeUnassessed: true });
    expect(result.frontier.length).toBeGreaterThan(0);
    const frontierIds = result.frontier.map(f => f.conceptId);
    expect(frontierIds).toContain('basics');
    expect(frontierIds).not.toContain('mastered');
    expect(result.totalConcepts).toBe(2);
    expect(result.masteredCount).toBe(1);
  });

  it('includes Fisher information for each frontier concept', () => {
    const kg = sm.getKnowledgeGraph();
    kg.addConcept(createConceptNode({ conceptId: 'concept-a', domain: 'test', specificity: 'topic' }));
    sm.save();
    sm = new StateManager(dataDir, userId);

    const result = handleGetZPDFrontier(sm, userId, { includeUnassessed: true });
    expect(result.frontier[0].fisherInfo).toBeDefined();
    expect(typeof result.frontier[0].fisherInfo).toBe('number');
    expect(result.frontier[0].fisherInfo).toBeGreaterThan(0);
  });

  it('returns empty frontier when all concepts mastered', () => {
    const kg = sm.getKnowledgeGraph();
    kg.addConcept(createConceptNode({ conceptId: 'mastered', domain: 'test', specificity: 'topic' }));
    const ucs = kg.getUserConceptState(userId, 'mastered');
    ucs.mastery = { mu: 3.0, sigma: 0.3 };
    ucs.assessmentCount = 5;
    kg.setUserConceptState(userId, 'mastered', ucs);
    sm.save();
    sm = new StateManager(dataDir, userId);

    const result = handleGetZPDFrontier(sm, userId);
    expect(result.frontier).toHaveLength(0);
    expect(result.masteredCount).toBe(1);
  });

  it('returns empty frontier when no concepts exist', () => {
    const result = handleGetZPDFrontier(sm, userId);
    expect(result.frontier).toHaveLength(0);
    expect(result.totalConcepts).toBe(0);
  });

  it('includes mastery value for each frontier concept', () => {
    const kg = sm.getKnowledgeGraph();
    kg.addConcept(createConceptNode({ conceptId: 'concept-a', domain: 'test', specificity: 'topic' }));
    sm.save();
    sm = new StateManager(dataDir, userId);

    const result = handleGetZPDFrontier(sm, userId, { includeUnassessed: true });
    expect(result.frontier[0].mastery).toBeDefined();
    expect(typeof result.frontier[0].mastery).toBe('number');
  });
});
