# Phase 2: PostgreSQL + API Service Design

**Date:** 2026-02-25
**Status:** Draft

## Goal

Replace JSON file persistence with PostgreSQL (Neon), add an API service layer, auth, and organizations. Make Entendi production-ready for multi-user deployment.

## Architecture Decisions

All decisions optimized for production readiness.

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Database | Neon PostgreSQL | Serverless Postgres, scales to zero, branching for dev/preview |
| ORM | Drizzle | TypeScript-first, type-safe, lightweight, great migrations |
| API Framework | Hono | Already used in dashboard, runs on Workers/Node/Deno/Bun |
| Auth | Better Auth | Open-source, TypeScript-native, org support built-in, stores in same Postgres |
| Deployment | Cloudflare Workers | Serverless, edge, zero ops, pairs with Neon HTTP driver |
| MCP Server | API client | Calls the API over HTTP instead of reading/writing JSON files |

## System Architecture

```
┌─────────────┐     ┌─────────────┐     ┌──────────────┐
│  Claude Code │     │ Web Browser │     │ Future IDEs  │
│  (MCP Server)│     │ (Dashboard) │     │ (Extensions) │
└──────┬───────┘     └──────┬──────┘     └──────┬───────┘
       │                    │                    │
       └────────────┬───────┴────────────────────┘
                    │ HTTP/REST
              ┌─────▼─────┐
              │  Hono API  │
              │ (Workers)  │
              ├────────────┤
              │ Better Auth│
              │ Middleware  │
              └─────┬──────┘
                    │ Neon HTTP Driver
              ┌─────▼──────┐
              │   Neon      │
              │ PostgreSQL  │
              └─────────────┘
```

## Database Schema

### Auth (managed by Better Auth)
```sql
-- Better Auth manages these tables automatically:
-- user, session, account, verification, organization, member, invitation
```

### Knowledge Graph

```sql
CREATE TABLE concepts (
  id            TEXT PRIMARY KEY,           -- canonical concept ID (e.g. 'react/hooks')
  aliases       TEXT[] NOT NULL DEFAULT '{}',
  domain        TEXT NOT NULL,
  specificity   TEXT NOT NULL CHECK (specificity IN ('domain', 'topic', 'technique')),
  parent_id     TEXT REFERENCES concepts(id),
  discrimination REAL NOT NULL DEFAULT 1.0,
  threshold_1   REAL NOT NULL DEFAULT -1.0,
  threshold_2   REAL NOT NULL DEFAULT 0.0,
  threshold_3   REAL NOT NULL DEFAULT 1.0,
  lifecycle     TEXT NOT NULL DEFAULT 'discovered'
                CHECK (lifecycle IN ('discovered','candidate','normalized','validated','stable','deprecated')),
  pop_mean_mastery    REAL NOT NULL DEFAULT 0.0,
  pop_assessment_count INT NOT NULL DEFAULT 0,
  pop_failure_rate    REAL NOT NULL DEFAULT 0.0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE concept_edges (
  source_id  TEXT NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
  target_id  TEXT NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
  edge_type  TEXT NOT NULL CHECK (edge_type IN (
    'requires','part_of','related_to','alternative_to','used_with','is_example_of'
  )),
  PRIMARY KEY (source_id, target_id, edge_type)
);

CREATE INDEX idx_concept_edges_target ON concept_edges(target_id);
```

### User Mastery State

```sql
CREATE TABLE user_concept_states (
  user_id       TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  concept_id    TEXT NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
  mu            REAL NOT NULL DEFAULT 0.0,
  sigma         REAL NOT NULL DEFAULT 1.5,
  stability     REAL NOT NULL DEFAULT 1.0,
  difficulty    REAL NOT NULL DEFAULT 5.0,
  last_assessed TIMESTAMPTZ,
  assessment_count      INT NOT NULL DEFAULT 0,
  tutored_count         INT NOT NULL DEFAULT 0,
  untutored_count       INT NOT NULL DEFAULT 0,
  mu_untutored          REAL NOT NULL DEFAULT 0.0,
  sigma_untutored       REAL NOT NULL DEFAULT 1.5,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, concept_id)
);
```

### Assessment History (append-only)

```sql
CREATE TABLE assessment_events (
  id              SERIAL PRIMARY KEY,
  user_id         TEXT NOT NULL,
  concept_id      TEXT NOT NULL,
  event_type      TEXT NOT NULL CHECK (event_type IN ('probe','tutor_phase1','tutor_phase4','implicit')),
  rubric_score    SMALLINT NOT NULL CHECK (rubric_score BETWEEN 0 AND 3),
  evaluator_confidence REAL NOT NULL CHECK (evaluator_confidence BETWEEN 0 AND 1),
  mu_before       REAL NOT NULL,
  mu_after        REAL NOT NULL,
  probe_depth     SMALLINT NOT NULL CHECK (probe_depth BETWEEN 0 AND 3),
  tutored         BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (user_id, concept_id) REFERENCES user_concept_states(user_id, concept_id) ON DELETE CASCADE
);

CREATE INDEX idx_assessment_events_user_concept ON assessment_events(user_id, concept_id);
CREATE INDEX idx_assessment_events_created ON assessment_events(created_at);
```

### Sessions (ephemeral, per-user)

```sql
CREATE TABLE tutor_sessions (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  concept_id        TEXT NOT NULL REFERENCES concepts(id),
  phase             TEXT NOT NULL CHECK (phase IN ('offered','phase1','phase2','phase3','phase4','complete')),
  started_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_activity_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  trigger_score     SMALLINT,
  phase1_score      SMALLINT,
  phase4_score      SMALLINT,
  last_misconception TEXT
);

CREATE TABLE tutor_exchanges (
  id          SERIAL PRIMARY KEY,
  session_id  TEXT NOT NULL REFERENCES tutor_sessions(id) ON DELETE CASCADE,
  phase       TEXT NOT NULL,
  question    TEXT NOT NULL,
  response    TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE probe_sessions (
  user_id             TEXT PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  pending_concept_id  TEXT REFERENCES concepts(id),
  pending_probe_data  JSONB,
  last_probe_time     TIMESTAMPTZ,
  probes_this_session INT NOT NULL DEFAULT 0
);

CREATE TABLE pending_actions (
  user_id    TEXT PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL,
  data       JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### Graph Traversal Queries

Prerequisites (recursive CTE):
```sql
WITH RECURSIVE prereqs AS (
  SELECT target_id AS concept_id, 1 AS depth
  FROM concept_edges
  WHERE source_id = $1 AND edge_type = 'requires'
  UNION ALL
  SELECT e.target_id, p.depth + 1
  FROM concept_edges e
  JOIN prereqs p ON e.source_id = p.concept_id
  WHERE e.edge_type = 'requires' AND p.depth < 10
)
SELECT * FROM prereqs;
```

ZPD Frontier:
```sql
-- Concepts where all prerequisites are mastered but concept itself is not
SELECT c.id, c.domain, c.specificity,
       COALESCE(ucs.mu, 0) AS mu,
       COALESCE(ucs.sigma, 1.5) AS sigma
FROM concepts c
LEFT JOIN user_concept_states ucs ON ucs.concept_id = c.id AND ucs.user_id = $1
WHERE (1.0 / (1.0 + EXP(-COALESCE(ucs.mu, 0)))) < $2  -- not mastered
  AND NOT EXISTS (
    SELECT 1 FROM concept_edges ce
    JOIN user_concept_states pucs ON pucs.concept_id = ce.target_id AND pucs.user_id = $1
    WHERE ce.source_id = c.id
      AND ce.edge_type = 'requires'
      AND (1.0 / (1.0 + EXP(-pucs.mu))) < $2  -- prerequisite not mastered
  )
ORDER BY c.id;
```

## API Routes

```
POST   /api/auth/*                    # Better Auth handles all auth routes
GET    /api/me                        # Current user profile + org

# Knowledge Graph (read)
GET    /api/concepts                  # List concepts (with filters)
GET    /api/concepts/:id              # Single concept + edges
GET    /api/concepts/:id/prerequisites # Recursive prerequisites

# User Mastery (requires auth)
GET    /api/mastery                   # All user concept states
GET    /api/mastery/:conceptId        # Single concept mastery
GET    /api/zpd-frontier              # ZPD frontier for current user

# MCP Server Endpoints (called by local MCP server, auth via API key)
POST   /api/mcp/observe               # entendi_observe
POST   /api/mcp/record-evaluation     # entendi_record_evaluation
POST   /api/mcp/tutor/start           # entendi_start_tutor
POST   /api/mcp/tutor/advance         # entendi_advance_tutor
POST   /api/mcp/dismiss               # entendi_dismiss
GET    /api/mcp/status                 # entendi_get_status
GET    /api/mcp/zpd-frontier           # entendi_get_zpd_frontier

# Org Management (org admin)
GET    /api/org/members                # List org members with mastery overview
GET    /api/org/members/:userId        # Detailed member knowledge graph
GET    /api/org/analytics              # Aggregate org analytics

# Assessment History
GET    /api/history                    # Assessment event log for current user
GET    /api/history/:conceptId         # Per-concept history
```

## Auth Model

Better Auth provides:
- Email/password + OAuth (Google, GitHub)
- Sessions (stored in Postgres)
- Organizations with roles (owner, admin, member)
- Invitations
- API key generation (for MCP server auth)

The MCP server authenticates via an API key stored in the user's environment:
```
ENTENDI_API_KEY=eak_xxxxxxxxxxxxx
ENTENDI_API_URL=https://api.entendi.dev
```

## Migration Strategy

**No dual-mode.** JSON persistence is removed. The MCP server calls the API.

1. Schema created via Drizzle migrations
2. Seed taxonomy loaded into `concepts` + `concept_edges` tables
3. Existing `.entendi/` JSON data can be imported via a one-time migration script
4. StateManager replaced with API client
5. MCP server tools rewritten to call API instead of in-memory state

## Project Structure

```
src/
├── api/                    # Hono API service
│   ├── index.ts            # App entry point
│   ├── routes/
│   │   ├── auth.ts         # Better Auth routes
│   │   ├── concepts.ts     # Concept CRUD
│   │   ├── mastery.ts      # User mastery endpoints
│   │   ├── mcp.ts          # MCP server proxy endpoints
│   │   ├── org.ts          # Organization management
│   │   └── history.ts      # Assessment history
│   ├── middleware/
│   │   └── auth.ts         # Auth middleware
│   └── db/
│       ├── schema.ts       # Drizzle schema definitions
│       ├── migrate.ts      # Migration runner
│       └── seed.ts         # Seed taxonomy loader
├── mcp/                    # MCP server (refactored to API client)
│   ├── server.ts
│   ├── api-client.ts       # HTTP client for API
│   └── tools/              # Tool implementations (call API)
├── core/                   # Shared business logic
│   ├── probabilistic-model.ts  # Bayesian math (shared)
│   ├── knowledge-graph.ts      # Graph operations (shared)
│   └── ...
└── hooks/                  # Unchanged (thin observers)
```

## What This Replaces

| Before (Phase 1c) | After (Phase 2) |
|--------------------|-----------------|
| `.entendi/*.json` files | Neon PostgreSQL |
| StateManager (file I/O) | Drizzle ORM + API client |
| In-memory state in MCP | API calls to Hono service |
| No auth | Better Auth (email, OAuth, API keys) |
| Single user | Multi-user with organizations |
| Local dashboard (Hono) | Production web dashboard |

## What Does NOT Change

- Core math: probabilistic-model.ts, Bayesian updates, FSRS
- Hook logic: post-tool-use.ts, user-prompt-submit.ts (still thin observers)
- MCP tool interface: same 7 tools, same input/output schemas
- Plugin distribution: still works the same way
