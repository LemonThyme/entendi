# Categorized Dismissals — Design Doc

**Date:** 2026-02-27
**Status:** Approved

## Problem

Probe dismissals are binary — either score 0 or dismiss. There's no way to distinguish between a user gaming the system ("I already know this"), legitimate deferral ("I'm busy right now"), and genuine topic changes. Admins have no visibility into dismissal patterns.

## Solution

Categorized dismissals with re-queue for busy deferrals. Three reason categories with different consequences, visible to admins in both the event slide-over timeline and a dedicated dismissals view.

## Dismissal Categories

| Reason | Consequence | Re-queue? |
|--------|------------|-----------|
| `topic_change` | Recorded, no penalty, no follow-up | No |
| `busy` | Recorded, probe re-queued as pending action for next session. Max 2 deferrals per concept before auto-score 0 | Yes |
| `claimed_expertise` | Recorded as score 0 immediately via `entendi_record_evaluation` | No (scored instead) |

## Data Layer

### Modify `dismissal_events` table

Add columns:

| Column | Type | Notes |
|--------|------|-------|
| reason | text, NOT NULL, default 'topic_change' | `topic_change`, `busy`, `claimed_expertise` |
| note | text, nullable | Optional free-text context from LLM |
| requeued | boolean, default false | Whether a pending action was created |
| resolvedAt | timestamptz, nullable | When deferred probe was answered or expired |
| resolvedAs | text, nullable | `answered`, `expired`, `auto_scored_0` |

### Modify `entendi_dismiss` MCP tool

- Add required `reason` param: `topic_change` | `busy` | `claimed_expertise`
- Add optional `note` param: string, max 500 chars
- When reason is `busy`:
  - Record dismissal with `requeued: true`
  - Create pending action for re-probe next session
  - If this is the 3rd busy deferral for same user+concept, auto-score 0 instead
- When reason is `claimed_expertise`:
  - Call `entendi_record_evaluation` with score 0 server-side
  - Record dismissal for audit trail

### New API endpoints

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `GET /api/org/dismissals` | GET | Org admin | Paginated dismissals for org members, filterable by reason/user/concept |
| `GET /api/org/dismissals/stats` | GET | Org admin | Aggregate stats: counts by reason, top dismissers, repeat offenders |

### Modified endpoints

| Endpoint | Change |
|----------|--------|
| `GET /api/analytics/concept/:conceptId` | Include dismissal events in timeline |
| `GET /api/org/members/:userId/history` | Include dismissals alongside assessment events |

## Admin Views

**Slide-over integration:** Dismissal events appear in event timelines alongside assessment events. Clicking opens the slide-over showing: reason category, note, re-queue status, resolution (if any).

**Dedicated dismissals view:** Filterable table in admin dashboard. Columns: user, concept, reason, note, date, resolution. Summary stats at top (counts by category, repeat deferral patterns).

## Skill Changes

Update concept-detection SKILL.md:
- `entendi_dismiss` now requires `reason` param
- Decision tree for LLM: topic_change vs busy vs claimed_expertise
- `claimed_expertise` triggers score 0 (LLM calls record_evaluation, not dismiss)

## Scope

- No changes to user-facing dashboard (dismissals are admin-only visibility)
- No changes to anomaly detection (already tracks dismiss ratio)
- Pending action re-queue uses existing pending_actions infrastructure
