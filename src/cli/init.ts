#!/usr/bin/env node

import { createInterface } from 'readline';
import { loadConfig, saveConfig } from '../shared/config.js';
import { configureCodex } from './platforms/codex.js';
import { configureCursor } from './platforms/cursor.js';
import { detectPlatforms, type Platform } from './platforms/detect.js';

function printHelp(): void {
  console.log(`
Usage: npx entendi init [options]

Options:
  --platform <name>  Configure only a specific platform (cursor, codex)
  --help             Show this help message

Examples:
  npx entendi init                  # Auto-detect and configure all platforms
  npx entendi init --platform cursor  # Configure Cursor only
`);
}

function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

type PlatformConfigurator = (
  projectDir: string,
  opts: { apiKey: string; apiUrl: string },
) => { files: string[] };

const CONFIGURATORS: Record<string, PlatformConfigurator> = {
  cursor: configureCursor,
  codex: configureCodex,
};

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    process.exit(0);
  }

  console.log('\n🧠 Entendi — Setting up comprehension tracking\n');

  // Parse --platform flag
  let platformFilter: string | undefined;
  const platformIdx = args.indexOf('--platform');
  if (platformIdx !== -1 && args[platformIdx + 1]) {
    platformFilter = args[platformIdx + 1];
    if (!CONFIGURATORS[platformFilter]) {
      console.error(
        `Unknown platform: ${platformFilter}. Supported: ${Object.keys(CONFIGURATORS).join(', ')}`,
      );
      process.exit(1);
    }
  }

  // Load config
  const config = loadConfig();
  let apiKey = config.apiKey;

  if (!apiKey) {
    console.log('No API key found in ~/.entendi/config.json');
    console.log('Get one at https://app.entendi.dev/settings or run: entendi login\n');
    apiKey = await prompt('API key: ');
    if (!apiKey) {
      console.error('API key is required.');
      process.exit(1);
    }
    saveConfig({ apiKey });
    console.log('API key saved to ~/.entendi/config.json\n');
  }

  const projectDir = process.cwd();
  const apiUrl = config.apiUrl;

  // Detect platforms
  let platforms: Platform[];
  if (platformFilter) {
    platforms = [{ id: platformFilter as Platform['id'], name: platformFilter }];
  } else {
    platforms = detectPlatforms(projectDir);
  }

  if (platforms.length === 0) {
    console.log('No supported AI coding platforms detected in this directory.');
    console.log('Supported: Cursor (.cursor/), Codex (.codex/), VS Code (.vscode/), OpenCode (opencode.json)');
    console.log('\nUse --platform <name> to configure manually.');
    process.exit(0);
  }

  console.log(`Detected platforms: ${platforms.map((p) => p.name).join(', ')}\n`);

  // Configure each platform
  const allFiles: string[] = [];
  const configured: string[] = [];

  for (const platform of platforms) {
    const configurator = CONFIGURATORS[platform.id];
    if (!configurator) {
      console.log(`  ⏭  ${platform.name} — no configurator yet, skipping`);
      continue;
    }

    try {
      const result = configurator(projectDir, { apiKey, apiUrl });
      allFiles.push(...result.files);
      configured.push(platform.name);
      console.log(`  ✅ ${platform.name} — configured (${result.files.length} files)`);
      for (const f of result.files) {
        console.log(`     ${f}`);
      }
    } catch (err) {
      console.error(`  ❌ ${platform.name} — failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  // Summary
  console.log(`\n${configured.length > 0 ? '🎉' : '⚠️'}  Done.`);
  if (configured.length > 0) {
    console.log(`Configured ${configured.length} platform${configured.length > 1 ? 's' : ''}: ${configured.join(', ')}`);
    console.log(`\nFiles written: ${allFiles.length}`);
  }
  if (platforms.some((p) => !CONFIGURATORS[p.id])) {
    console.log('\nSome detected platforms don\'t have configurators yet (VS Code, OpenCode).');
  }
  console.log('');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
