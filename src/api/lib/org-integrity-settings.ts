import { eq } from 'drizzle-orm';
import { DEFAULT_THRESHOLDS, type IntegrityThresholds } from '../../core/response-integrity.js';
import type { Database } from '../db/connection.js';
import { member, organization } from '../db/schema.js';

export interface OrgIntegritySettings extends IntegrityThresholds {
  dampeningThreshold: number;
  emaAlpha: number;
}

const DEFAULTS: OrgIntegritySettings = {
  ...DEFAULT_THRESHOLDS,
  dampeningThreshold: 0.5,
  emaAlpha: 0.3,
};

// Permissive settings that effectively disable integrity checks
const EXEMPT: OrgIntegritySettings = {
  charsPerSecondThreshold: 9999,
  formattingScoreThreshold: 9999,
  wordCountThreshold: 99999,
  styleDriftWordCountRatio: 9999,
  styleDriftCharsPerSecRatio: 9999,
  styleDriftFormattingDiff: 9999,
  dampeningThreshold: 0,
  emaAlpha: 0.3,
};

/**
 * Get the effective integrity settings for a user based on their org membership.
 *
 * Org metadata JSON can contain:
 *   - `integrityExempt: true` — all integrity checks effectively disabled
 *   - `integritySettings: { charsPerSecondThreshold, formattingScoreThreshold, ... }`
 *
 * If the user belongs to multiple orgs, the strictest settings win:
 *   - For thresholds: Math.min (lower = stricter)
 *   - For dampeningThreshold: Math.max (higher = stricter, dampens more)
 *   - For emaAlpha: keep default (no multi-org override)
 */
export async function getOrgIntegritySettings(db: Database, userId: string): Promise<OrgIntegritySettings> {
  const memberships = await db
    .select({ metadata: organization.metadata })
    .from(member)
    .innerJoin(organization, eq(member.organizationId, organization.id))
    .where(eq(member.userId, userId));

  const effective = { ...DEFAULTS };

  for (const row of memberships) {
    if (!row.metadata) continue;
    try {
      const parsed = JSON.parse(row.metadata);
      if (parsed.integrityExempt === true) return { ...EXEMPT };
      if (parsed.integritySettings) {
        const s = parsed.integritySettings;
        // Strictest wins: lower thresholds = stricter
        if (typeof s.charsPerSecondThreshold === 'number') {
          effective.charsPerSecondThreshold = Math.min(effective.charsPerSecondThreshold, s.charsPerSecondThreshold);
        }
        if (typeof s.formattingScoreThreshold === 'number') {
          effective.formattingScoreThreshold = Math.min(effective.formattingScoreThreshold, s.formattingScoreThreshold);
        }
        if (typeof s.wordCountThreshold === 'number') {
          effective.wordCountThreshold = Math.min(effective.wordCountThreshold, s.wordCountThreshold);
        }
        if (typeof s.styleDriftWordCountRatio === 'number') {
          effective.styleDriftWordCountRatio = Math.min(effective.styleDriftWordCountRatio, s.styleDriftWordCountRatio);
        }
        if (typeof s.styleDriftCharsPerSecRatio === 'number') {
          effective.styleDriftCharsPerSecRatio = Math.min(effective.styleDriftCharsPerSecRatio, s.styleDriftCharsPerSecRatio);
        }
        if (typeof s.styleDriftFormattingDiff === 'number') {
          effective.styleDriftFormattingDiff = Math.min(effective.styleDriftFormattingDiff, s.styleDriftFormattingDiff);
        }
        // Strictest wins: higher dampeningThreshold = stricter
        if (typeof s.dampeningThreshold === 'number') {
          effective.dampeningThreshold = Math.max(effective.dampeningThreshold, s.dampeningThreshold);
        }
      }
    } catch {
      // ignore malformed metadata
    }
  }

  return effective;
}
