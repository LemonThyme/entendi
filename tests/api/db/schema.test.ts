import { describe, it, expect } from 'vitest';
import { concepts, conceptEdges, userConceptStates, assessmentEvents, tutorSessions, tutorExchanges, probeSessions, pendingActions } from '../../../src/api/db/schema.js';
import { getTableName } from 'drizzle-orm';

describe('Drizzle schema', () => {
  it('defines all 8 tables', () => {
    const tables = [concepts, conceptEdges, userConceptStates, assessmentEvents, tutorSessions, tutorExchanges, probeSessions, pendingActions];
    expect(tables).toHaveLength(8);
    tables.forEach(t => expect(getTableName(t)).toBeDefined());
  });

  it('concepts table has correct name', () => {
    expect(getTableName(concepts)).toBe('concepts');
  });

  it('concept_edges has correct name', () => {
    expect(getTableName(conceptEdges)).toBe('concept_edges');
  });

  it('user_concept_states has correct name', () => {
    expect(getTableName(userConceptStates)).toBe('user_concept_states');
  });

  it('assessment_events has correct name', () => {
    expect(getTableName(assessmentEvents)).toBe('assessment_events');
  });
});
