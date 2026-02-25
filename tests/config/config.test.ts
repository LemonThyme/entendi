import { describe, it, expect } from 'vitest';
import { createDefaultOrgPolicy, createDefaultUserPreferences } from '../../src/config/org-policy.js';

describe('OrgPolicy', () => {
  it('creates default org policy with correct values', () => {
    const policy = createDefaultOrgPolicy();
    expect(policy.orgId).toBe('local');
    expect(policy.version).toBe(1);
    expect(policy.enabled).toBe(true);
    expect(policy.tutorMode).toBe('both');
    expect(policy.tutorTriggerThreshold).toBe(1);
    expect(policy.scopedDomains).toBeNull();
    expect(policy.maxProbesPerHour).toBe(15);
    expect(policy.minProbeIntervalMinutes).toBe(2);
    expect(policy.maxDepthPerChain).toBe(3);
    expect(policy.masteryThreshold).toBe(0.7);
    expect(policy.tutoredEvidenceWeight).toBe(0.6);
    expect(policy.counterfactualReporting).toBe(false);
  });
});

describe('UserPreferences', () => {
  it('creates default user preferences', () => {
    const prefs = createDefaultUserPreferences();
    expect(prefs.autoAcceptTutor).toBe(false);
    expect(prefs.hintEscalationSpeed).toBe('moderate');
    expect(prefs.showScoresInline).toBe(true);
    expect(prefs.notificationVerbosity).toBe('normal');
  });
});
