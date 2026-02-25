import type { RubricScore } from '../schemas/types.js';

export interface OrgPolicy {
  orgId: string;
  version: number;
  enabled: boolean;
  tutorMode: 'reactive' | 'proactive' | 'both' | 'off';
  tutorTriggerThreshold: RubricScore;
  scopedDomains: string[] | null;
  maxProbesPerHour: number;
  minProbeIntervalMinutes: number;
  maxDepthPerChain: number;
  masteryThreshold: number;
  tutoredEvidenceWeight: number;
  counterfactualReporting: boolean;
}

export function createDefaultOrgPolicy(): OrgPolicy {
  return {
    orgId: 'local',
    version: 1,
    enabled: true,
    tutorMode: 'both',
    tutorTriggerThreshold: 1 as RubricScore,
    scopedDomains: null,
    maxProbesPerHour: 15,
    minProbeIntervalMinutes: 2,
    maxDepthPerChain: 3,
    masteryThreshold: 0.7,
    tutoredEvidenceWeight: 0.6,
    counterfactualReporting: false,
  };
}

export interface UserPreferences {
  autoAcceptTutor: boolean;
  hintEscalationSpeed: 'patient' | 'moderate' | 'fast';
  showScoresInline: boolean;
  notificationVerbosity: 'quiet' | 'normal' | 'verbose';
}

export function createDefaultUserPreferences(): UserPreferences {
  return {
    autoAcceptTutor: false,
    hintEscalationSpeed: 'moderate',
    showScoresInline: true,
    notificationVerbosity: 'normal',
  };
}
