import { execFileSync } from 'child_process';
import * as esbuild from 'esbuild';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
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

// Clean previous build to prevent stale files
rmSync(pluginDir, { recursive: true, force: true });

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

// 1b. Stamp plugin version with git hash to bust Claude Code's plugin cache
let gitHash = 'unknown';
try {
  gitHash = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf-8' }).trim();
} catch {
  // not in a git repo — use timestamp as fallback
  gitHash = Date.now().toString(36);
}

const pluginJsonPath = join(pluginDir, '.claude-plugin', 'plugin.json');
if (existsSync(pluginJsonPath)) {
  const pluginMeta = JSON.parse(readFileSync(pluginJsonPath, 'utf-8'));
  pluginMeta.version = `${pluginMeta.version}+${gitHash}`;
  writeFileSync(pluginJsonPath, JSON.stringify(pluginMeta, null, 2) + '\n');
  console.log(`Plugin version stamped: ${pluginMeta.version}`);
}

// 2. Copy bundled hook entrypoints (JS bundles + bash wrappers)
const hookEntrypoints = ['user-prompt-submit.js', 'stop.js', 'pre-compact.js', 'session-end.js', 'notification.js'];
mkdirSync(join(pluginDir, 'hooks'), { recursive: true });
for (const file of hookEntrypoints) {
  const src = join('dist', 'hooks', file);
  if (existsSync(src)) {
    copyFileSync(src, join(pluginDir, 'hooks', file));
    chmodSync(join(pluginDir, 'hooks', file), 0o755);
  }
}

// 2b. Ensure bash wrapper scripts and run-hook.cmd are executable
const hookScripts = [
  'run-hook.cmd', 'session-init', 'session-start', 'subagent-start', 'user-prompt-submit',
  'stop', 'session-end', 'pre-compact', 'auto-approve', 'tool-failure',
  'config-change', 'notification', 'task-completed',
];
for (const file of hookScripts) {
  const dest = join(pluginDir, 'hooks', file);
  if (existsSync(dest)) {
    chmodSync(dest, 0o755);
  }
}

// 3. Copy bundled MCP server
mkdirSync(join(pluginDir, 'mcp'), { recursive: true });
const mcpSrc = join('dist', 'mcp', 'server.js');
if (existsSync(mcpSrc)) {
  copyFileSync(mcpSrc, join(pluginDir, 'mcp', 'server.js'));
  chmodSync(join(pluginDir, 'mcp', 'server.js'), 0o755);
}

// --- Dashboard asset build ---
mkdirSync('public/assets', { recursive: true });

const dashboardBuild = await esbuild.build({
  entryPoints: [
    join('src', 'dashboard', 'dashboard.js'),
    join('src', 'dashboard', 'dashboard.css'),
    join('src', 'dashboard', 'link.js'),
  ],
  bundle: false,
  minify: true,
  outdir: join('public', 'assets'),
  entryNames: '[name]-[hash]',
  metafile: true,
});

// Separate bundled build for charts.js (ECharts tree-shaken)
const chartsBuild = await esbuild.build({
  entryPoints: [join('src', 'dashboard', 'charts.js')],
  bundle: true,
  minify: true,
  outdir: join('public', 'assets'),
  entryNames: '[name]-[hash]',
  metafile: true,
  format: 'esm',
});

// Generate asset manifest from metafile
const manifest: Record<string, string> = {};
for (const build of [dashboardBuild, chartsBuild]) {
  for (const [outPath, meta] of Object.entries(build.metafile!.outputs)) {
    if (meta.entryPoint) {
      const name = meta.entryPoint.replace('src/dashboard/', '');
      const hashed = outPath.replace('public/', '/');
      manifest[name] = hashed;
    }
  }
}
writeFileSync(join('public', 'assets', 'manifest.json'), JSON.stringify(manifest, null, 2));

// Generate importable manifest module for Workers (fs.readFileSync doesn't work there)
const manifestModule = `// Auto-generated by esbuild.config.ts — do not edit
export const manifest: Record<string, string> = ${JSON.stringify(manifest, null, 2)};
`;
writeFileSync(join('src', 'dashboard', 'manifest.ts'), manifestModule);
console.log('Dashboard asset manifest:', manifest);
