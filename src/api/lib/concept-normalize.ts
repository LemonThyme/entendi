/**
 * Deterministic concept ID normalization.
 * Tier 1 of the three-tier normalization pipeline.
 *
 * Rules:
 * 1. Lowercase
 * 2. Replace / . _ spaces with -
 * 3. Collapse consecutive -
 * 4. Strip leading/trailing -
 * 5. Truncate to 200 chars
 */
export function normalizeConcept(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[\/\._ ]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 200);
}
