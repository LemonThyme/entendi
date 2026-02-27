# Event Detail Drill-Down — Implementation Plan

**Design doc:** `docs/plans/2026-02-27-event-detail-drilldown-design.md`

## Task Breakdown

### Layer 1: Schema + Migration (API/Core)

**Task 1: Add `event_annotations` table to Drizzle schema**
- File: `src/api/db/schema.ts`
- Add `eventAnnotations` table: id (serial PK), eventId (int FK → assessmentEvents.id CASCADE), authorId (text FK → user.id), text (text NOT NULL), createdAt (timestamptz default now())
- Add index on eventId

**Task 2: Run migration**
- `npx drizzle-kit generate` then `npx drizzle-kit push` (or however the project runs migrations)

### Layer 2: API Endpoints (API/Core)

**Task 3: Add `GET /api/events/:eventId` endpoint**
- File: new route file `src/api/routes/events-detail.ts` or add to existing events routes
- Auth: requireAuth, verify event belongs to authenticated user
- Return full event record + joined concept name/domain
- No annotations in user view

**Task 4: Add `GET /api/org/events/:eventId` endpoint**
- File: `src/api/routes/org.ts`
- Auth: requireAuth, verify event's userId is in caller's org
- Return full event record + concept info + annotations (joined with author names)

**Task 5: Add annotation CRUD endpoints**
- `POST /api/org/events/:eventId/annotations` — create annotation (validate eventId exists, user is org admin, event's user is in org)
- `DELETE /api/org/annotations/:annotationId` — delete own annotation only
- File: `src/api/routes/org.ts`

**Task 6: Modify `GET /api/analytics/timeline/:conceptId`**
- File: `src/api/routes/analytics.ts` (or wherever this lives)
- Add `eventId` (assessment_events.id) to each timeline entry

**Task 7: Modify `GET /api/org/members/:userId/history`**
- File: `src/api/routes/org.ts`
- Add `responseText`, `evaluationCriteria`, `responseFeatures` to the select

### Layer 3: Dashboard UI (Frontend)

**Task 8: Build slide-over panel component**
- File: `src/dashboard/dashboard.js`
- Reusable `openEventPanel(eventData, options)` function
- Panel: fixed position right, 420px wide, backdrop overlay
- Compact layout per design: concept link, domain link, score row, criteria, response (truncated, expandable), signals chips
- Prev/Next navigation (accepts list of event IDs + current index)
- Escape key and backdrop click to close
- Admin annotations section (conditionally rendered)

**Task 9: Wire chart click handlers**
- Mastery timeline chart in `openConceptDetail`: add ECharts `click` event → extract eventId from timeline data → `openEventPanel()`
- Requires timeline data to now include eventId (depends on Task 6)

**Task 10: Wire table row click handlers**
- Assessment history table rows in concept detail → click opens panel
- Integrity tab flagged responses table → click opens panel
- Admin member detail tables → click opens panel (uses org endpoint)

**Task 11: Annotation UI for admins**
- "Add annotation" button in panel → inline textarea + submit
- POST to `/api/org/events/:eventId/annotations`
- Render existing annotations with author name + timestamp
- Delete button on own annotations

**Task 12: CSS for slide-over panel**
- File: `src/dashboard/styles.css`
- `.event-panel` styles: fixed right, slide-in transition, backdrop
- `.event-panel-link` styles for clickable data elements
- Responsive: narrower on mobile

### Layer 4: Tests

**Task 13: API tests for new endpoints**
- Test `GET /api/events/:eventId` — own event returns full data, other user's event returns 403
- Test `GET /api/org/events/:eventId` — org admin sees member's event, non-member returns 403
- Test annotation CRUD — create, delete own, can't delete others'
- Test timeline endpoint includes eventId

## Agent Team Structure

3 teammates split by layer to avoid file conflicts:

### Teammate: api-core
**Files:** `src/api/db/schema.ts`, `src/api/routes/org.ts`, `src/api/routes/events-detail.ts`, `src/api/routes/analytics.ts`, `src/api/routes/dashboard.ts`
**Tasks:** 1, 2, 3, 4, 5, 6, 7

### Teammate: dashboard-ui
**Files:** `src/dashboard/dashboard.js`, `src/dashboard/styles.css`
**Tasks:** 8, 9, 10, 11, 12
**Blocked by:** Task 6 (needs eventId in timeline data) — can start building panel component immediately, wire chart clicks after api-core completes Task 6

### Teammate: tests
**Files:** `test/**`
**Tasks:** 13
**Blocked by:** Tasks 3, 4, 5, 6 (needs API endpoints to exist)
