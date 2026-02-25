import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig } from '../../src/config/config-loader.js';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('loadConfig', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'entendi-config-'));
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('returns defaults when no config files exist', () => {
    const config = loadConfig(dataDir);
    expect(config.orgPolicy.orgId).toBe('local');
    expect(config.orgPolicy.tutorMode).toBe('both');
    expect(config.userPrefs.autoAcceptTutor).toBe(false);
  });

  it('loads org policy from cached file', () => {
    writeFileSync(join(dataDir, 'org-policy.json'), JSON.stringify({
      orgId: 'acme-corp',
      version: 2,
      enabled: true,
      tutorMode: 'reactive',
      tutorTriggerThreshold: 0,
      scopedDomains: ['web-development'],
      maxProbesPerHour: 10,
      minProbeIntervalMinutes: 5,
      maxDepthPerChain: 2,
      masteryThreshold: 0.8,
      tutoredEvidenceWeight: 0.4,
      counterfactualReporting: true,
    }));
    const config = loadConfig(dataDir);
    expect(config.orgPolicy.orgId).toBe('acme-corp');
    expect(config.orgPolicy.tutorMode).toBe('reactive');
    expect(config.orgPolicy.scopedDomains).toEqual(['web-development']);
    expect(config.orgPolicy.masteryThreshold).toBe(0.8);
  });

  it('loads user preferences from file', () => {
    const prefsDir = join(dataDir, 'user-prefs');
    mkdirSync(prefsDir, { recursive: true });
    writeFileSync(join(prefsDir, 'preferences.json'), JSON.stringify({
      autoAcceptTutor: true,
      hintEscalationSpeed: 'fast',
      showScoresInline: false,
      notificationVerbosity: 'quiet',
    }));
    const config = loadConfig(dataDir, join(prefsDir, 'preferences.json'));
    expect(config.userPrefs.autoAcceptTutor).toBe(true);
    expect(config.userPrefs.hintEscalationSpeed).toBe('fast');
  });

  it('falls back to defaults on corrupted org policy JSON', () => {
    writeFileSync(join(dataDir, 'org-policy.json'), 'NOT JSON{{{');
    const config = loadConfig(dataDir);
    expect(config.orgPolicy.orgId).toBe('local');
  });

  it('falls back to defaults on corrupted preferences JSON', () => {
    const prefsPath = join(dataDir, 'bad-prefs.json');
    writeFileSync(prefsPath, 'broken{');
    const config = loadConfig(dataDir, prefsPath);
    expect(config.userPrefs.autoAcceptTutor).toBe(false);
  });

  it('merges partial org policy with defaults', () => {
    writeFileSync(join(dataDir, 'org-policy.json'), JSON.stringify({
      orgId: 'partial-org',
      tutorMode: 'off',
    }));
    const config = loadConfig(dataDir);
    expect(config.orgPolicy.orgId).toBe('partial-org');
    expect(config.orgPolicy.tutorMode).toBe('off');
    expect(config.orgPolicy.maxProbesPerHour).toBe(15);
  });
});
