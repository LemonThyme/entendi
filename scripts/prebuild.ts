/**
 * Prebuild script — ensures auto-generated stub files exist before tsc runs.
 * These files are overwritten with real content by esbuild.config.ts.
 */
import { existsSync, writeFileSync } from 'fs';

const stubs: Array<{ path: string; content: string }> = [
  {
    path: 'src/dashboard/manifest.ts',
    content: 'export const manifest: Record<string, string> = {};\n',
  },
  {
    path: 'src/mcp/views/_app-bridge-bundle.ts',
    content: "export const APP_BRIDGE_BUNDLE = '';\n",
  },
];

for (const { path, content } of stubs) {
  if (!existsSync(path)) {
    writeFileSync(path, content);
    console.log(`Prebuild: created stub ${path}`);
  }
}
