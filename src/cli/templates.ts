import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

/**
 * Resolve the templates directory.
 * In the built CLI (dist/cli/init.js), templates are at dist/cli/templates/.
 * During tests, we fall back to src/cli/templates/.
 */
export function getTemplatesDir(): string {
  // When running from built dist/cli/init.js, __dirname equivalent is dist/cli/
  const thisDir = dirname(fileURLToPath(import.meta.url));

  // Check for dist/cli/templates/ (production)
  const distTemplates = join(thisDir, 'templates');
  if (existsSync(distTemplates)) {
    return distTemplates;
  }

  // Fallback: src/cli/templates/ (development/test)
  const srcTemplates = join(thisDir, '..', '..', 'src', 'cli', 'templates');
  if (existsSync(srcTemplates)) {
    return srcTemplates;
  }

  // Last resort: return the dist path (config writers have inline fallbacks)
  return distTemplates;
}
