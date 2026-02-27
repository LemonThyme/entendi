# Event Detail Drill-Down — Design Doc

**Date:** 2026-02-27
**Status:** Approved

## Problem

Dashboard chart datapoints and table rows are not clickable. Users and org admins cannot inspect individual assessment events — the actual response, evaluation criteria, score rationale, and integrity signals are stored in the DB but never surfaced.

## Solution

A slide-over panel triggered by clicking any assessment event datapoint (chart or table row). Shows the full event record in a compact, no-scroll layout where every piece of data is a navigable link.

Org admins get the same view plus the ability to annotate events.

## Approach

**Approach A: Single event detail endpoint + slide-over component.**

- New API endpoints for event detail (user + org admin) and annotations
- Reusable slide-over panel component in the dashboard
- Triggered from: mastery timeline chart, assessment history table, integrity flagged table, admin member views
- Annotations stored in a new `event_annotations` table

## Data Layer

### New table: `event_annotations`

| Column    | Type         | Notes                                  |
|-----------|--------------|----------------------------------------|
| id        | serial       | PK                                     |
| eventId   | integer      | FK → assessment_events.id, ON DELETE CASCADE |
| authorId  | text         | FK → user.id                           |
| text      | text         | Annotation body                        |
| createdAt | timestamptz  | default now()                          |

Indexed on `eventId`.

### New endpoints

| Endpoint                                    | Method | Auth          | Description                        |
|---------------------------------------------|--------|---------------|------------------------------------|
| `/api/events/:eventId`                      | GET    | User (own)    | Full event detail for own events   |
| `/api/org/events/:eventId`                  | GET    | Org admin     | Full event detail for any org member's event |
| `/api/org/events/:eventId/annotations`      | POST   | Org admin     | Create annotation                  |
| `/api/org/annotations/:annotationId`        | DELETE | Org admin     | Delete own annotation              |

### Modified endpoints

| Endpoint                                     | Change                                        |
|----------------------------------------------|-----------------------------------------------|
| `GET /api/analytics/timeline/:conceptId`     | Add `eventId` to each timeline entry           |
| `GET /api/org/members/:userId/history`       | Add `responseText`, `evaluationCriteria`, `responseFeatures` |

### Event detail response shape

```json
{
  "id": 123,
  "conceptId": "recursive-cte",
  "conceptName": "recursive-cte",
  "domain": "databases",
  "eventType": "probe",
  "rubricScore": 2,
  "evaluatorConfidence": 0.85,
  "muBefore": 0.62,
  "muAfter": 0.71,
  "probeDepth": 1,
  "responseText": "The user explained...",
  "evaluationCriteria": "Explain how X works...",
  "responseFeatures": { "charsPerSecond": 8.2, "formattingScore": 1, "wordCount": 43 },
  "integrityScore": 0.84,
  "tutored": false,
  "createdAt": "2026-02-27T...",
  "annotations": [
    { "id": 1, "authorName": "TK", "text": "Looks like copy-paste", "createdAt": "..." }
  ]
}
```

## Slide-over Panel UI

Compact, no-scroll. Every data element is a navigable link:

- **Concept name** → opens concept detail view
- **Domain badge** → concepts tab filtered by domain
- **Mastery delta** → concept mastery timeline (highlights this event)
- **Integrity score** → integrity tab / member integrity view
- **Signals** → integrity history for user/concept
- **Prev/Next arrows** → step through events in current list context

Layout:
- Response text truncated to ~3 lines, click to expand inline
- Evaluation criteria as single truncated line with title tooltip
- Signals as inline chips
- Annotations collapsed to count + most recent; click to see all
- Escape key or backdrop click closes

## Chart & Table Integration

**Trigger points:**
1. Mastery timeline chart (concept detail) — ECharts click handler → `openEventDetail(eventId)`
2. Assessment history table rows (concept detail) — click handler
3. Integrity tab flagged responses table — click handler
4. Admin member detail history/flagged tables — uses org endpoint, shows annotations

**No changes to:** Activity heatmap, learning velocity chart, domain radar (all aggregated, not per-event).

## Scope Exclusions

- No new chart types
- No event-level routing (no `#/event/123` URLs)
- Users cannot annotate their own events (admin-only feature)
