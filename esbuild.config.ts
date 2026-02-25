import * as esbuild from 'esbuild';
import { chmodSync, readdirSync, mkdirSync, copyFileSync, existsSync } from 'fs';
import { join } from 'path';

const hookDir = join('src', 'hooks');
let hookFiles: string[] = [];
try {
  hookFiles = readdirSync(hookDir)
    .filter(f => f.endsWith('.ts'))
    .map(f => join(hookDir, f));
} catch {
  // hooks dir may not exist yet
}

// --- Existing builds (local dev) ---

if (hookFiles.length > 0) {
  await esbuild.build({
    entryPoints: hookFiles,
    bundle: true,
    platform: 'node',
    target: 'node22',
    outdir: 'dist/hooks',
    format: 'esm',
    banner: { js: '#!/usr/bin/env node' },
    external: ['@anthropic-ai/sdk'],
  });
}

await esbuild.build({
  entryPoints: [join('src', 'mcp', 'server.ts')],
  bundle: true,
  platform: 'node',
  target: 'node22',
  outdir: 'dist/mcp',
  format: 'esm',
  banner: { js: '#!/usr/bin/env node' },
  external: ['@anthropic-ai/sdk'],
});

// Make all built entry points executable
const outputs = [
  ...hookFiles.map(f => join('dist', 'hooks', f.replace(/^src\/hooks\//, '').replace(/\.ts$/, '.js'))),
  join('dist', 'mcp', 'server.js'),
];
for (const out of outputs) {
  try {
    chmodSync(out, 0o755);
  } catch {
    // file may not exist if build was partial
  }
}

// --- Plugin assembly ---

const pluginDir = join('dist', 'plugin');

/** Recursively copy a directory, creating parents as needed. */
function copyDir(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      copyFileSync(srcPath, destPath);
    }
  }
}

// 1. Copy static plugin metadata
if (existsSync('plugin')) {
  copyDir('plugin', pluginDir);
}

// 2. Copy bundled hook entrypoints (only the two CLI scripts)
const hookEntrypoints = ['post-tool-use.js', 'user-prompt-submit.js'];
mkdirSync(join(pluginDir, 'hooks'), { recursive: true });
for (const file of hookEntrypoints) {
  const src = join('dist', 'hooks', file);
  if (existsSync(src)) {
    copyFileSync(src, join(pluginDir, 'hooks', file));
    chmodSync(join(pluginDir, 'hooks', file), 0o755);
  }
}

// 3. Copy bundled MCP server
mkdirSync(join(pluginDir, 'mcp'), { recursive: true });
const mcpSrc = join('dist', 'mcp', 'server.js');
if (existsSync(mcpSrc)) {
  copyFileSync(mcpSrc, join(pluginDir, 'mcp', 'server.js'));
  chmodSync(join(pluginDir, 'mcp', 'server.js'), 0o755);
}
