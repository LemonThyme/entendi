# Multi-Platform Entendi — Design Document

**Date**: 2026-03-03
**Status**: Approved
**Platforms**: Cursor, Codex CLI (priority); OpenCode, Cline (future)

## Goal

Ship Entendi on every major AI coding platform with parity to the Claude Code experience. Users should get automatic concept detection, seamless probing, and zero-friction install regardless of platform.

## Architecture: Three-Tier Progressive Enhancement

```
Tier 1: Remote MCP (any platform, zero install)
  └── Streamable HTTP endpoint at /mcp on existing Cloudflare Worker
  └── OAuth via Better Auth (browser redirect)
  └── All 9 MCP tools available immediately
  └── Concept detection depends on LLM following tool descriptions

Tier 2: npx entendi init (optimal experience per platform)
  └── Auto-detects installed platforms (Claude Code, Cursor, Codex, VS Code, etc.)
  └── Writes MCP config (local stdio or remote URL) per platform
  └── Injects concept-detection skill/rules per platform format
  └── Sets up hooks where supported (dual-format Superpowers pattern)
  └── Handles auth (device-code flow → ~/.entendi/config.json)

Tier 3: Claude Code plugin (gold standard, unchanged)
  └── claude plugin install entendi
  └── Full hooks, skills, MCP server, enforcement
```

## Component Design

### 1. Remote MCP Endpoint (`/mcp`)

Add Streamable HTTP transport to the existing Hono app on Cloudflare Workers.

**Transport**: Streamable HTTP (single endpoint, stateless-friendly, spec 2025-06-18+)
**Auth**: OAuth 2.1 via Better Auth. Browser redirect for initial auth, bearer token for subsequent requests. Fall back to API key header for CLI-authenticated users.
**Session**: Stateless — each request carries auth token, no server-side session needed.
**Tools**: Same 9 tools as stdio MCP server. Reuse existing tool handlers from `src/mcp/server.ts`.

```
POST https://api.entendi.dev/mcp
Authorization: Bearer <token>
Content-Type: application/json

{"jsonrpc": "2.0", "method": "tools/call", "params": {...}}
```

**Implementation approach**: Use `@modelcontextprotocol/sdk` `StreamableHTTPServerTransport` inside a Hono route handler. The transport handles JSON-RPC framing; we plug in the same tool handlers.

### 2. CLI Installer (`npx entendi init`)

A single CLI command that configures Entendi for all detected AI tools.

**Platform detection**: Check for config file existence:
- Claude Code: `~/.claude.json` or `~/.claude/` directory
- Cursor: `.cursor/` in project or `~/.cursor/`
- Codex: `.codex/` in project or `~/.codex/`
- VS Code: `.vscode/` in project
- OpenCode: `opencode.json` or `~/.config/opencode/`

**Per-platform output**:

| Platform | MCP Config | Instructions | Hooks |
|----------|-----------|-------------|-------|
| Claude Code | `.mcp.json` (stdio) | Plugin install (full) | Full lifecycle |
| Cursor | `.cursor/mcp.json` | `.cursor/rules/entendi.mdc` (alwaysApply) | Dual-format SessionStart |
| Codex | `.codex/config.toml` | Skill directory + AGENTS.md snippet | None (not available) |
| VS Code | `.vscode/mcp.json` | N/A (Copilot uses MCP tools directly) | N/A |

**Auth flow**: The CLI runs `entendi login` (device-code flow) if no `~/.entendi/config.json` exists, then uses the API key for MCP server config.

**File generation**: Each platform gets a generated config file. The CLI is idempotent — running it again updates existing config without duplication.

### 3. Concept-Detection Skill (Agent Skills Standard)

Package the concept-detection instructions as a proper SKILL.md following the agentskills.io spec.

```
entendi-concept-detection/
├── SKILL.md          # Frontmatter + concept detection instructions
├── references/
│   └── probe-rubric.md   # Evaluation criteria reference
└── scripts/
    └── check-pending.sh  # Check for pending probes (optional)
```

**SKILL.md frontmatter**:
```yaml
---
name: entendi-concept-detection
description: >
  Proactive concept detection for comprehension probing. Identifies technical
  concepts in conversation and calls entendi_observe to trigger understanding
  checks. Always active during technical discussions.
---
```

The body contains the same instructions as our current `plugin/skills/concept-detection/SKILL.md`, adapted for cross-platform use (removing Claude Code-specific references).

**Distribution**:
- Bundled in the Claude Code plugin (current)
- Written by `npx entendi init` to the platform skill directory
- Published to skills registries (SkillsMP, Anthropic catalog)

### 4. Platform-Specific Rules Files

#### Cursor: `.cursor/rules/entendi.mdc`

```yaml
---
description: "Entendi comprehension tracking — always observe concepts"
alwaysApply: true
---

[Concept detection instructions adapted for Cursor]
[Includes MCP tool usage instructions]
[Probe response handling]
```

Keep under 500 tokens for the alwaysApply rule. Link to the full skill for details.

#### Codex: AGENTS.md snippet

Append to existing AGENTS.md (or create if missing):

```markdown
## Entendi — Comprehension Tracking

When working with technical concepts, call `entendi_observe` with detected
concepts before finishing your response. If it returns `shouldProbe: true`,
append the probe question. Score responses 0-3 using the rubric.
```

Plus a skill directory at `.codex/skills/entendi-concept-detection/SKILL.md`.

### 5. Dual-Format Hooks (Superpowers Pattern)

For platforms that support hooks, use a single shell script that outputs both formats:

```json
{
  "additional_context": "...",
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": "..."
  }
}
```

This covers:
- Claude Code: reads `hookSpecificOutput.additionalContext`
- Cursor: reads `additional_context`
- Cline (future): reads `contextModification`

### 6. OAuth for Remote MCP

Add OAuth 2.1 authorization server endpoints to the Hono app:

- `GET /oauth/authorize` — redirect to login page
- `POST /oauth/token` — exchange code for access token
- `GET /.well-known/oauth-authorization-server` — metadata discovery (RFC 8414)

Better Auth already handles sessions. The OAuth layer wraps it with PKCE support for MCP clients.

## Data Flow Per Platform

### Cursor User (Tier 2)
```
npx entendi init
  → Detects .cursor/
  → Writes .cursor/mcp.json (stdio server pointing to local entendi binary)
  → Writes .cursor/rules/entendi.mdc (alwaysApply concept detection)
  → Auth via device-code flow

User opens Cursor, starts coding
  → Rule injects concept-detection instructions into every conversation
  → LLM detects concepts, calls entendi_observe (MCP tool)
  → If shouldProbe: true, LLM appends probe question
  → User answers, LLM calls entendi_record_evaluation
```

### Codex User (Tier 2)
```
npx entendi init
  → Detects .codex/
  → Writes .codex/config.toml MCP entry
  → Writes .codex/skills/entendi-concept-detection/SKILL.md
  → Appends concept-detection snippet to AGENTS.md
  → Auth via device-code flow

User runs codex, starts coding
  → AGENTS.md + skill inject concept-detection instructions
  → LLM detects concepts, calls entendi_observe (MCP tool)
  → Probe flow same as Cursor
```

### Any Platform (Tier 1)
```
User adds to their MCP config:
  { "entendi": { "url": "https://api.entendi.dev/mcp" } }
  → OAuth redirect for auth
  → MCP tools available
  → Concept detection depends on LLM initiative (no injected instructions)
```

## Parity Analysis

| Capability | Claude Code | Cursor (Tier 2) | Codex (Tier 2) | Any (Tier 1) |
|-----------|-------------|-----------------|----------------|--------------|
| MCP tools | Full | Full | Full | Full |
| Concept detection | Skill (always active) | Rule (alwaysApply) | Skill + AGENTS.md | LLM discretion |
| Probe delivery | Hook-injected | Rule-instructed | Skill-instructed | LLM discretion |
| Probe enforcement | Stop hook validates | No enforcement | No enforcement | No enforcement |
| Login detection | UserPromptSubmit hook | Rule hint | AGENTS.md hint | Manual |
| Auto-update | SessionStart check | npx entendi update | npx entendi update | N/A (remote) |
| Install UX | claude plugin install | npx entendi init | npx entendi init | Paste URL |

**Biggest parity gaps on non-Claude-Code platforms**:
1. No enforcement (can't block session end without hooks)
2. Concept detection is LLM-compliance-dependent (rules vs hooks)
3. No dynamic state injection (pending probes must be pulled, not pushed)

**Mitigations**:
- Craft rules/skill instructions to be as directive as possible
- Include "check for pending probes" instruction in always-on rules
- The remote MCP endpoint could return pending probe state with every `observe` call
- Future: as Cursor/Codex hooks mature, add enforcement

## File Structure

```
src/
  cli/
    init.ts              # npx entendi init — platform detection + config generation
    platforms/
      claude-code.ts     # Claude Code plugin install
      cursor.ts          # .cursor/mcp.json + .cursor/rules/entendi.mdc
      codex.ts           # .codex/config.toml + AGENTS.md + skill
      vscode.ts          # .vscode/mcp.json
    templates/
      cursor-rule.mdc    # Cursor always-apply rule template
      codex-agents.md    # AGENTS.md snippet template
      skill.md           # Cross-platform SKILL.md template
  mcp/
    transports/
      streamable-http.ts # Streamable HTTP transport for Hono
    server.ts            # Existing stdio server (unchanged)
  api/
    routes/
      mcp-remote.ts      # /mcp endpoint (Streamable HTTP)
      oauth.ts           # OAuth 2.1 endpoints for MCP auth
```

## Non-Goals (This Phase)

- OpenCode/Cline support (future, after Cursor+Codex proven)
- MCP Apps (inline dashboard in Claude chat)
- Skills registry publishing (manual for now)
- VS Code extension (MCP config via CLI is sufficient)
- Probe enforcement on non-Claude-Code platforms
