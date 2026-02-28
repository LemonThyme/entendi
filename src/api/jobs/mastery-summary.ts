/**
 * Mastery summary cron job.
 * Sends periodic email summaries to users with their mastery progress.
 * Triggered by Cloudflare Workers Cron Trigger (Monday 8AM UTC).
 */
import { and, eq, gte, } from 'drizzle-orm';
import type { Database } from '../db/connection.js';
import { assessmentEvents, concepts, emailPreferences, user, userConceptStates } from '../db/schema.js';
import { EmailTemplate, sendEmail } from '../lib/email.js';
import { generateSparklineSvg } from '../lib/sparkline.js';

export interface MasterySummaryResult {
  sent: number;
  skipped: number;
  errors: number;
}

export async function runMasterySummaryJob(db: Database): Promise<MasterySummaryResult> {
  const result: MasterySummaryResult = { sent: 0, skipped: 0, errors: 0 };

  // Get all users who have email preferences not set to 'off'
  // Left join so users without prefs get the default (weekly)
  const users = await db
    .select({
      id: user.id,
      email: user.email,
      name: user.name,
      summaryFrequency: emailPreferences.summaryFrequency,
    })
    .from(user)
    .leftJoin(emailPreferences, eq(user.id, emailPreferences.userId));

  const now = new Date();
  const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  for (const u of users) {
    // Skip users who opted out
    const freq = u.summaryFrequency ?? 'weekly';
    if (freq === 'off') {
      result.skipped++;
      continue;
    }

    // For biweekly/monthly, check if it's the right cadence
    if (freq === 'biweekly' && now.getDate() > 14) {
      // Only send in first two weeks of month (rough biweekly)
      const weekOfMonth = Math.ceil(now.getDate() / 7);
      if (weekOfMonth % 2 !== 1) {
        result.skipped++;
        continue;
      }
    }
    if (freq === 'monthly' && now.getDate() > 7) {
      // Only send first week of month
      result.skipped++;
      continue;
    }

    try {
      // Get user's concept states
      const states = await db
        .select({
          conceptId: userConceptStates.conceptId,
          mu: userConceptStates.mu,
          conceptName: concepts.id,
        })
        .from(userConceptStates)
        .innerJoin(concepts, eq(userConceptStates.conceptId, concepts.id))
        .where(eq(userConceptStates.userId, u.id));

      if (states.length === 0) {
        result.skipped++;
        continue;
      }

      // Get recent assessment events for sparkline
      const recentEvents = await db
        .select({
          muAfter: assessmentEvents.muAfter,
          createdAt: assessmentEvents.createdAt,
        })
        .from(assessmentEvents)
        .where(
          and(
            eq(assessmentEvents.userId, u.id),
            gte(assessmentEvents.createdAt, oneWeekAgo),
          ),
        )
        .orderBy(assessmentEvents.createdAt);

      // Build sparkline from recent events (average mastery over time)
      const sparklineData = recentEvents.map(e => e.muAfter);
      const sparkline = sparklineData.length > 0
        ? generateSparklineSvg(sparklineData, { width: 400, height: 60, showYLabels: true })
        : '';

      // Identify improved and decayed concepts
      const improved: string[] = [];
      const decayed: string[] = [];

      // Check recent events for improvement/decay
      const recentByConceptMap = new Map<string, { first: number; last: number; name: string }>();
      const allRecentEvents = await db
        .select({
          conceptId: assessmentEvents.conceptId,
          muBefore: assessmentEvents.muBefore,
          muAfter: assessmentEvents.muAfter,
          createdAt: assessmentEvents.createdAt,
        })
        .from(assessmentEvents)
        .where(
          and(
            eq(assessmentEvents.userId, u.id),
            gte(assessmentEvents.createdAt, oneWeekAgo),
          ),
        )
        .orderBy(assessmentEvents.createdAt);

      for (const event of allRecentEvents) {
        const existing = recentByConceptMap.get(event.conceptId);
        if (!existing) {
          recentByConceptMap.set(event.conceptId, {
            first: event.muBefore,
            last: event.muAfter,
            name: event.conceptId,
          });
        } else {
          existing.last = event.muAfter;
        }
      }

      for (const [, data] of recentByConceptMap) {
        const delta = data.last - data.first;
        if (delta > 0.1) improved.push(data.name);
        else if (delta < -0.1) decayed.push(data.name);
      }

      const dateStr = now.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });

      const emailResult = await sendEmail({
        to: u.email,
        template: EmailTemplate.MasterySummary,
        vars: {
          date: dateStr,
          sparkline,
          improved: improved.join(', ') || '',
          decayed: decayed.join(', ') || '',
          totalConcepts: String(states.length),
          dashboardLink: process.env.BETTER_AUTH_URL || 'https://entendi.dev',
        },
      });

      if (emailResult.skipped || emailResult.id) {
        result.sent++;
      } else {
        result.errors++;
      }
    } catch (err) {
      console.error(`[MasterySummary] Error for user ${u.id}:`, err);
      result.errors++;
    }
  }

  return result;
}
