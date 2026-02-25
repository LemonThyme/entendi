import { readStdin, type HookInput } from './shared.js';

async function main() {
  const raw = await readStdin();
  const input: HookInput = JSON.parse(raw);
  // Phase 0: no-op
  process.exit(0);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  main().catch(() => process.exit(0));
}
