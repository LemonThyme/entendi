# Codebases & Syllabi Design

**Date**: 2026-03-03
**Status**: Approved
**Replaces**: Courses feature (deprecated)

## Overview

Two new first-class features for structured learning in Entendi:

- **Codebases** — connect a GitHub repo, auto-extract concepts via agent analysis, teacher curates the concept map, developers enroll and get probed on codebase-specific concepts as they work.
- **Syllabi** — upload PDFs/documents/URLs, auto-extract concepts via agent analysis, teacher curates, learners enroll and get probed on curriculum concepts.

Both share the existing concept system (`concepts`, `conceptEdges`, `userConceptStates`). Mastery tracking is concept-level and source-agnostic — codebases and syllabi are scoping/organization layers on top.

Courses are deprecated. Codebases + syllabi cover both use cases better.

## Data Model

### Codebases

```sql
CREATE TABLE codebases (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  org_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  github_repo_owner TEXT,
  github_repo_name TEXT,
  github_repo_id TEXT,
  github_installation_id TEXT REFERENCES github_installations(id),
  last_sync_commit TEXT,
  last_sync_at TIMESTAMPTZ,
  sync_status TEXT NOT NULL DEFAULT 'idle',  -- idle | syncing | pending_review | error
  status TEXT NOT NULL DEFAULT 'draft',      -- draft | active
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE codebase_concepts (
  codebase_id TEXT NOT NULL REFERENCES codebases(id) ON DELETE CASCADE,
  concept_id TEXT NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
  importance TEXT NOT NULL DEFAULT 'supporting',  -- core | supporting | peripheral
  learning_objective TEXT,
  auto_extracted BOOLEAN NOT NULL DEFAULT true,
  curated_by TEXT REFERENCES "user"(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (codebase_id, concept_id)
);

CREATE TABLE codebase_enrollments (
  codebase_id TEXT NOT NULL REFERENCES codebases(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active',  -- active | completed
  enrolled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (codebase_id, user_id)
);
```

### Syllabi

```sql
CREATE TABLE syllabi (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  org_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'draft',  -- draft | active
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE syllabus_sources (
  id TEXT PRIMARY KEY,
  syllabus_id TEXT NOT NULL REFERENCES syllabi(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL,  -- pdf | url | markdown | manual
  source_url TEXT,
  file_name TEXT,
  extraction_status TEXT NOT NULL DEFAULT 'pending',  -- pending | extracted | error
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE syllabus_concepts (
  syllabus_id TEXT NOT NULL REFERENCES syllabi(id) ON DELETE CASCADE,
  concept_id TEXT NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
  importance TEXT NOT NULL DEFAULT 'supporting',  -- core | supporting | peripheral
  learning_objective TEXT,
  auto_extracted BOOLEAN NOT NULL DEFAULT true,
  curated_by TEXT REFERENCES "user"(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (syllabus_id, concept_id)
);

CREATE TABLE syllabus_enrollments (
  syllabus_id TEXT NOT NULL REFERENCES syllabi(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active',  -- active | completed
  enrolled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (syllabus_id, user_id)
);
```

### GitHub Integration

```sql
CREATE TABLE github_installations (
  id TEXT PRIMARY KEY,  -- GitHub's installation ID
  org_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  github_org_login TEXT NOT NULL,
  installed_by TEXT NOT NULL REFERENCES "user"(id),
  access_token TEXT,
  token_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### Custom Roles & Permissions

```sql
CREATE TABLE org_roles (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, name)
);

CREATE TABLE org_role_permissions (
  role_id TEXT NOT NULL REFERENCES org_roles(id) ON DELETE CASCADE,
  permission TEXT NOT NULL,
  PRIMARY KEY (role_id, permission)
);

-- Extend member table: add role_id FK
ALTER TABLE member ADD COLUMN role_id TEXT REFERENCES org_roles(id);
```

**Permission keys**:
- `codebases.create`, `codebases.edit`, `codebases.delete`, `codebases.view_progress`
- `syllabi.create`, `syllabi.edit`, `syllabi.delete`, `syllabi.view_progress`
- `members.invite`, `members.manage_roles`, `members.view`
- `org.settings`, `org.billing`

**Built-in roles** (seeded on org creation, not deletable):
- **Owner**: All permissions (set by Better Auth)
- **Admin**: Everything except `org.billing`
- **Member**: View own progress only (default)

## GitHub App Integration

### Installation Flow

1. Admin clicks "Connect GitHub" in dashboard
2. Redirect to `github.com/apps/entendi/installations/new`
3. GitHub redirects back with `installation_id`
4. Store in `github_installations`, verify via GitHub API
5. Admin picks which repos to register as codebases

### Token Management

GitHub App installation tokens expire after ~1 hour. On each API call:
1. Check `token_expires_at`
2. If expired, refresh via `POST /app/installations/{id}/access_tokens` using the App's private key
3. Update stored token

### Webhook Handling

Register a webhook endpoint (`POST /api/github/webhook`) that receives push events. On significant file changes (README, CLAUDE.md, schema files, entry points), mark the codebase `sync_status: "pending_review"` and notify the teacher.

## Concept Extraction

### Tiered Analysis (Codebases)

| Tier | Files | Purpose | Token cost |
|------|-------|---------|------------|
| 1 — Structure | README, CLAUDE.md, package.json, dir tree | Architecture, stack, high-level concepts | ~5k |
| 2 — Key files | Entry points, configs, schemas, routes | Patterns, libraries, domain concepts | ~20k |
| 3 — Deep dive | Teacher-flagged directories | Detailed implementation concepts | On-demand |

### Extraction Pipeline

1. Fetch files via GitHub API using installation token
2. Agent reads files, produces draft concept map: `[{ conceptId, importance, learningObjective }]`
3. Each concept is resolved via the existing three-tier normalization (deterministic → embedding → LLM)
4. Draft stored in `codebase_concepts` with `auto_extracted: true`, `curated_by: null`
5. Teacher reviews in dashboard: approve, edit, remove, add concepts
6. Approved concepts get `curated_by` set

### Syllabus Extraction

Same pattern:
1. Teacher uploads PDF/URL → stored in `syllabus_sources`
2. Agent reads document, proposes concept map
3. Teacher curates in dashboard

## Plugin Integration & Probe Scoping

### Auto-Detection

On `SessionStart`, the plugin sends the repo's git remote URL to `POST /mcp/observe`. The server resolves it to a codebase (if registered). If the user is enrolled (or belongs to the owning org), probes are scoped.

### Scoping Rules

- User in registered codebase → codebase concepts get +0.3 urgency boost
- User in unregistered repo → normal behavior
- User enrolled in syllabus → syllabus concepts always eligible regardless of repo

### API Change

`POST /mcp/observe` gets an optional `repoUrl` field. Server resolves to codebase and adjusts probe candidate weighting.

### Progress Tracking

No new tracking tables. Progress is a **view** over existing `userConceptStates`:

```
For each concept in codebase_concepts:
  mastery = pMastery(userConceptStates[user][concept].mu)
  threshold = importance-based (core: 0.8, supporting: 0.6, peripheral: 0.4)
  met = mastery >= threshold
completion = met_count / total_count
```

## Courses Deprecation

- Stop exposing course creation/enrollment in the dashboard
- Keep course tables and API routes for backward compatibility (read-only)
- No data migration needed — courses and codebases/syllabi are independent
- Remove course routes from OpenAPI spec

## Dashboard UI

### Codebases Section

- List view: name, repo, concept count, enrolled members, sync status
- Detail view: concept map (grouped by importance), member progress, sync controls
- Concept curation: approve/reject auto-extracted, add manual, edit learning objectives

### Syllabi Section

- List view: name, source count, concept count, enrolled members
- Detail view: concept map, member progress, source management
- Source management: upload PDF, add URL, view extraction status

### Roles Section (under Org settings)

- List custom roles with permission summary
- Create/edit role: name, description, permission checkboxes
- Assign roles to members
