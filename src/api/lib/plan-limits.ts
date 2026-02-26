/**
 * Plan limits for concept tracking.
 * Defines per-plan resource limits for Entendi subscriptions.
 */

export type Plan = 'free' | 'earned_free' | 'pro' | 'team';

export interface PlanLimits {
  maxConcepts: number;
}

const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  free: { maxConcepts: 25 },
  earned_free: { maxConcepts: 50 },
  pro: { maxConcepts: Infinity },
  team: { maxConcepts: Infinity },
};

export function getPlanLimits(plan: Plan): PlanLimits {
  return PLAN_LIMITS[plan];
}

export function isValidPlan(plan: string): plan is Plan {
  return plan in PLAN_LIMITS;
}
