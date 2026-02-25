import * as esbuild from 'esbuild';
import { readdirSync } from 'fs';
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

// Build MCP server entry point
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
