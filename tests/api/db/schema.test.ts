import { getTableName } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {account, apikey,assessmentEvents,conceptEdges, 
  concepts, invitation, member, organization, pendingActions,probeSessions, session, tutorExchanges, 
  tutorSessions, 
  user, userConceptStates, verification, 
} from '../../../src/api/db/schema.js';

describe('Drizzle schema', () => {
  const appTables = [concepts, conceptEdges, userConceptStates, assessmentEvents, tutorSessions, tutorExchanges, probeSessions, pendingActions];
  const authTables = [user, session, account, verification, organization, member, invitation, apikey];

  it('defines all 16 tables', () => {
    const all = [...appTables, ...authTables];
    expect(all).toHaveLength(16);
    for (const t of all) expect(getTableName(t)).toBeDefined();
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

  it('auth tables have correct names', () => {
    expect(getTableName(user)).toBe('user');
    expect(getTableName(session)).toBe('session');
    expect(getTableName(account)).toBe('account');
    expect(getTableName(verification)).toBe('verification');
    expect(getTableName(organization)).toBe('organization');
    expect(getTableName(member)).toBe('member');
    expect(getTableName(invitation)).toBe('invitation');
    expect(getTableName(apikey)).toBe('apikey');
  });
});
