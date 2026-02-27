/** Convert mu (log-odds) to probability 0-1 */
export function pMastery(mu: number): number {
  return 1 / (1 + Math.exp(-mu));
}

/** Format mastery as { value, low, high } percentages — mu +/- 2sigma clamped to 0-100 */
export function masteryRange(mu: number, sigma: number): { value: number; low: number; high: number } {
  const p = pMastery(mu);
  const low = Math.max(0, pMastery(mu - 2 * sigma));
  const high = Math.min(1, pMastery(mu + 2 * sigma));
  return {
    value: Math.round(p * 100),
    low: Math.round(low * 100),
    high: Math.round(high * 100),
  };
}

/** Human-readable mastery range string: "65\u201385%" */
export function masteryLabel(mu: number, sigma: number): string {
  const range = masteryRange(mu, sigma);
  return `${range.low}\u2013${range.high}%`;
}

/** Determine trend direction from last N mastery values */
export function trendDirection(values: number[]): 'up' | 'down' | 'flat' {
  if (values.length < 2) return 'flat';
  const last = values[values.length - 1];
  const first = values[0];
  const delta = last - first;
  if (Math.abs(delta) < 0.03) return 'flat';
  return delta > 0 ? 'up' : 'down';
}
