# Entendi Plugin Distribution Design

**Date:** 2026-02-25
**Status:** Draft

## Problem

Entendi requires both an MCP server and Claude Code hooks to function. Currently these are configured manually via gitignored files (`.mcp.json`, `.claude/settings.local.json`) with hardcoded absolute paths. New users have no way to install Entendi.

## Solution

Package Entendi as a Claude Code plugin — the official mechanism for distributing MCP servers + hooks as a single installable unit.

## Plugin Structure

The build produces a self-contained plugin directory at `dist/plugin/`:

```
dist/plugin/
├── .claude-plugin/
│   └── plugin.json              # Manifest
├── .mcp.json                    # MCP server (direct format)
├── hooks/
│   ├── hooks.json               # Hook configuration
│   ├── post-tool-use.js         # Bundled hook
│   └── user-prompt-submit.js    # Bundled hook
└── mcp/
    └── server.js                # Bundled MCP server
```

### Plugin Manifest (`.claude-plugin/plugin.json`)

```json
{
  "name": "entendi",
  "description": "Comprehension accountability layer for AI-assisted work",
  "version": "0.1.0",
  "author": { "name": "TK" },
  "repository": "https://github.com/tk/entendi",
  "license": "MIT",
  "keywords": ["comprehension", "learning", "bayesian", "knowledge-graph"]
}
```

### MCP Configuration (`.mcp.json`)

Uses the direct format (no `mcpServers` wrapper) per plugin convention. `${CLAUDE_PLUGIN_ROOT}` resolves to the installed plugin directory.

```json
{
  "entendi": {
    "command": "node",
    "args": ["${CLAUDE_PLUGIN_ROOT}/mcp/server.js"]
  }
}
```

### Hooks Configuration (`hooks/hooks.json`)

```json
{
  "description": "Entendi comprehension probing hooks",
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "node '${CLAUDE_PLUGIN_ROOT}/hooks/post-tool-use.js'",
            "timeout": 30
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node '${CLAUDE_PLUGIN_ROOT}/hooks/user-prompt-submit.js'",
            "timeout": 30
          }
        ]
      }
    ]
  }
}
```

## Source Layout

Static plugin metadata lives in `plugin/` (version-controlled):

```
plugin/
├── .claude-plugin/
│   └── plugin.json
├── .mcp.json
└── hooks/
    └── hooks.json
```

The build step copies these + compiled JS into `dist/plugin/`.

## Build Changes

Update `esbuild.config.ts` to:

1. Build hooks → `dist/plugin/hooks/*.js` (instead of `dist/hooks/`)
2. Build MCP server → `dist/plugin/mcp/server.js` (instead of `dist/mcp/`)
3. Copy `plugin/` static files → `dist/plugin/`
4. Set executable permissions on JS files

Add `npm run build:plugin` script (or fold into existing `build`).

## Distribution

### Self-Hosted Marketplace

Add `.claude-plugin/marketplace.json` at repo root:

```json
{
  "name": "entendi",
  "description": "Comprehension accountability layer for AI-assisted work",
  "owner": { "name": "TK" },
  "plugins": [
    {
      "name": "entendi",
      "description": "Comprehension accountability layer for AI-assisted work",
      "version": "0.1.0",
      "source": "./dist/plugin",
      "category": "learning"
    }
  ]
}
```

### Installation (end user)

```bash
# Add the marketplace
claude plugin marketplace add github:tk/entendi

# Install
claude plugin install entendi
```

### Local Development

For working on entendi itself, two options:

1. **Plugin mode:** `claude --plugin-dir ./dist/plugin` (after `npm run build`)
2. **Legacy mode:** Keep using `.claude/settings.local.json` + project `.mcp.json` (current setup, no build needed for hook logic changes during TDD)

## Migration

- Existing `.claude/settings.local.json` and `.mcp.json` stay for local dev (both gitignored)
- No breaking changes — plugin is a new distribution artifact alongside existing setup
- `dist/plugin/` added to `.gitignore` (build artifact)

## What This Does NOT Change

- Core logic (`src/core/`)
- MCP server implementation (`src/mcp/`)
- Hook logic (`src/hooks/`)
- Test suite
- TypeScript compilation

Only the build output structure and packaging change.
