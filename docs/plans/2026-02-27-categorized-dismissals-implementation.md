# Categorized Dismissals — Implementation Plan

**Design doc:** `docs/plans/2026-02-27-categorized-dismissals-design.md`

## Task Breakdown

### Layer 1: Schema + API (api-core)

**Task 1: Add columns to `dismissal_events` table**
- File: `src/api/db/schema.ts`
- Add to `dismissalEvents`: reason (text NOT NULL default 'topic_change'), note (text nullable), requeued (boolean default false), resolvedAt (timestamptz nullable), resolvedAs (text nullable)
- Run `npx drizzle-kit generate && npx drizzle-kit push`

**Task 2: Update `POST /api/mcp/dismiss` to accept reason + note**
- File: `src/api/routes/mcp.ts`
- Add Zod schema for dismiss body: reason (enum: topic_change, busy, claimed_expertise), note (string max 500 optional)
- Parse body in dismiss handler
- When reason=busy: check if this is 3rd+ busy deferral for same user+concept (query dismissal_events). If so, auto-score 0 via applyBayesianUpdateDb. Otherwise, record dismissal with requeued=true, create pending action with actionType='deferred_probe' containing conceptId.
- When reason=claimed_expertise: record dismissal, ALSO create assessment_event with score 0 via applyBayesianUpdateDb
- When reason=topic_change: record dismissal as before, just with reason field
- Always pass reason and note to the insert

**Task 3: Update MCP server + api-client for new dismiss params**
- File: `src/mcp/server.ts` — update entendi_dismiss tool schema: reason becomes required enum (topic_change, busy, claimed_expertise), add optional note string param
- File: `src/mcp/api-client.ts` — update dismiss method signature to accept { reason, note }

**Task 4: Add `GET /api/org/dismissals` + stats endpoints**
- File: `src/api/routes/org.ts`
- `GET /dismissals` — paginated list, filterable by ?reason=&userId=&conceptId=. Join with user table for names, concepts for domain. Include reason, note, requeued, resolvedAt, resolvedAs.
- `GET /dismissals/stats` — aggregate: counts by reason category, top 5 users by dismissal count, repeat busy deferrals (same concept 2+ times)

**Task 5: Include dismissals in existing timeline endpoints**
- `GET /api/analytics/concept/:conceptId` — include dismissal events in timeline array (type: 'dismissal', with reason/note)
- `GET /api/org/members/:userId/history` — include dismissals interleaved with assessment events, sorted by date

### Layer 2: Dashboard UI (dashboard-ui)

**Task 6: Show dismissals in slide-over panel**
- File: `src/dashboard/dashboard.js`
- When a dismissal event is clicked in a timeline/table, open the slide-over with: reason category (styled badge), note (if any), re-queue status, resolution status
- Dismissal rows in tables get a distinct visual treatment (muted/italic, with reason badge)

**Task 7: Add dismissals section to admin dashboard**
- File: `src/dashboard/dashboard.js`, `src/dashboard/styles.css`
- New section in admin member detail or org tab: dismissals table with filters (reason, concept)
- Summary stats cards at top (counts by category)

### Layer 3: Skill Update (skill)

**Task 8: Update concept-detection SKILL.md with dismiss decision tree**
- File: `plugin/skills/concept-detection/SKILL.md`
- Update the Refusal Handling section: claimed_expertise → call record_evaluation with score 0 (not dismiss)
- Add decision tree for dismiss reason selection
- Update MCP Tools section to document new dismiss params

### Layer 4: Tests

**Task 9: Write tests for categorized dismissals**
- Test dismiss with each reason category
- Test busy auto-escalation (3rd busy → score 0)
- Test claimed_expertise creates assessment event
- Test org dismissals endpoint (pagination, filters)
- Test dismissals appear in timeline endpoints
- Test MCP tool schema validation (reason required)

## Agent Team Structure

### Teammate: api-core
**Files:** `src/api/db/schema.ts`, `src/api/routes/mcp.ts`, `src/api/routes/org.ts`, `src/api/routes/analytics.ts`, `src/api/routes/dashboard.ts`, `src/mcp/server.ts`, `src/mcp/api-client.ts`
**Tasks:** 1, 2, 3, 4, 5

### Teammate: dashboard-ui
**Files:** `src/dashboard/dashboard.js`, `src/dashboard/styles.css`
**Tasks:** 6, 7
**Blocked by:** Task 5 (needs dismissals in timeline data)

### Teammate: skill-and-tests
**Files:** `plugin/skills/concept-detection/SKILL.md`, `test/**`
**Tasks:** 8, 9
**Task 8 has no blockers (skill update). Task 9 blocked by Tasks 2, 3, 4, 5.**
