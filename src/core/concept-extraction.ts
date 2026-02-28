import { PACKAGE_CONCEPT_MAP } from '../config/package-concepts.js';
import type { ExtractedConcept } from '../schemas/types.js';

/**
 * Extended concept with domain information from the package mapping.
 * Adds `domain` to the base ExtractedConcept for richer downstream use.
 */
export interface PackageExtractedConcept extends ExtractedConcept {
  domain: string;
}

/**
 * Patterns that match package install commands across ecosystems.
 * Each pattern captures the package manager + install verb portion.
 * The rest of the command line contains packages and flags.
 */
const INSTALL_PATTERNS: RegExp[] = [
  // npm install|i|add [flags] <packages>
  /^npm\s+(?:install|i|add)\b/,
  // yarn add [flags] <packages>
  /^yarn\s+add\b/,
  // pnpm add|install [flags] <packages>  (pnpm install with args = add packages)
  /^pnpm\s+(?:add|install)\b/,
  // pip/pip3 install [flags] <packages>
  /^pip3?\s+install\b/,
  // cargo add <packages>
  /^cargo\s+add\b/,
  // go get <packages>
  /^go\s+get\b/,
  // gem install <packages>
  /^gem\s+install\b/,
  // composer require <packages>
  /^composer\s+require\b/,
];

/**
 * Detects whether a shell command is a package install command.
 */
export function detectPackageInstall(command: string): boolean {
  const trimmed = command.trim();
  if (!trimmed) return false;
  return INSTALL_PATTERNS.some(pattern => pattern.test(trimmed));
}

/**
 * Extracts the install verb pattern from a command, returning the regex match
 * or null if the command is not a package install command.
 */
function matchInstallPattern(command: string): { pattern: RegExp; trimmed: string } | null {
  const trimmed = command.trim();
  if (!trimmed) return null;
  for (const pattern of INSTALL_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { pattern, trimmed };
    }
  }
  return null;
}

/**
 * Parses package names from a package install command.
 * Returns an empty array if the command is not a recognized install command.
 *
 * Handles:
 * - Multiple packages in one command
 * - Version specifiers (e.g., redis@4.0.0, flask>=2.0)
 * - Flags (e.g., -D, --save-dev, --global)
 * - Scoped npm packages (e.g., @anthropic-ai/sdk)
 */
export function parsePackageFromCommand(command: string): string[] {
  const match = matchInstallPattern(command);
  if (!match) return [];

  const { pattern, trimmed } = match;

  // Remove the install command prefix to get just the arguments
  const argsString = trimmed.replace(pattern, '').trim();
  if (!argsString) return [];

  const tokens = argsString.split(/\s+/);
  const packages: string[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;

    // Skip flags (--save-dev, -D, --global, etc.)
    if (token.startsWith('-')) {
      // If it's a flag that takes a value (like --registry <url>), skip the next token too
      // Common value-taking flags:
      if (/^--(?:registry|prefix|cache)$/.test(token) && i + 1 < tokens.length) {
        i++;
      }
      continue;
    }

    // This token is a package name (possibly with version specifier)
    const packageName = stripVersionSpecifier(token);
    if (packageName) {
      packages.push(packageName);
    }
  }

  return packages;
}

/**
 * Strips version specifiers from a package identifier.
 *
 * Handles:
 * - npm-style: redis@4.0.0, @scope/pkg@1.0.0
 * - pip-style: flask>=2.0, flask==2.0, flask~=2.0, flask!=2.0
 */
function stripVersionSpecifier(packageId: string): string {
  if (!packageId) return '';

  // Handle scoped npm packages: @scope/pkg@version
  // The first @ is the scope prefix, the second @ (if present) is the version delimiter
  if (packageId.startsWith('@')) {
    const afterScope = packageId.indexOf('/', 1);
    if (afterScope === -1) {
      // Malformed scoped package, return as-is
      return packageId;
    }
    const rest = packageId.substring(afterScope + 1);
    const versionAt = rest.indexOf('@');
    if (versionAt !== -1) {
      return packageId.substring(0, afterScope + 1 + versionAt);
    }
    // Also check for pip-style version specifiers in scoped packages (unlikely but safe)
    const pipVersion = rest.search(/[><=!~]/);
    if (pipVersion !== -1) {
      return packageId.substring(0, afterScope + 1 + pipVersion);
    }
    return packageId;
  }

  // Unscoped packages: strip @version
  const atIndex = packageId.indexOf('@');
  if (atIndex !== -1) {
    return packageId.substring(0, atIndex);
  }

  // Strip pip-style version specifiers: >=, ==, ~=, !=, <=, >, <
  const pipVersion = packageId.search(/[><=!~]/);
  if (pipVersion !== -1) {
    return packageId.substring(0, pipVersion);
  }

  return packageId;
}

/**
 * Maps a package name to extracted concepts using the lookup table.
 * Returns an empty array for unrecognized packages.
 *
 * The returned objects extend ExtractedConcept with a `domain` field
 * from the package mapping, providing richer context for downstream use.
 */
export function extractConceptsFromPackage(packageName: string): PackageExtractedConcept[] {
  const mappings = PACKAGE_CONCEPT_MAP[packageName];
  if (!mappings || mappings.length === 0) return [];

  return mappings.map(mapping => ({
    name: mapping.name,
    specificity: mapping.specificity,
    confidence: mapping.confidence,
    extractionSignal: 'package' as const,
    domain: mapping.domain,
  }));
}
