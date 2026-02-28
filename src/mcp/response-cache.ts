/**
 * Simple in-memory cache for read-only API responses.
 * Uses a Map with timestamps — no LRU or size limits.
 */

export interface CacheEntry<T = unknown> {
  data: T;
  cachedAt: number;
}

export interface ResponseCacheOptions {
  /** Time-to-live in milliseconds (default: 60_000 = 60s). */
  ttlMs?: number;
}

export class ResponseCache {
  private cache = new Map<string, CacheEntry>();
  private ttlMs: number;

  constructor(options?: ResponseCacheOptions) {
    this.ttlMs = options?.ttlMs ?? 60_000;
  }

  /** Build a cache key from method + path. */
  static key(method: string, path: string): string {
    return `${method}:${path}`;
  }

  /** Get a cached value if it exists and hasn't expired. */
  get<T = unknown>(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.cachedAt > this.ttlMs) {
      this.cache.delete(key);
      return undefined;
    }
    return entry.data as T;
  }

  /** Store a value in the cache. */
  set<T = unknown>(key: string, data: T): void {
    this.cache.set(key, { data, cachedAt: Date.now() });
  }

  /** Invalidate a specific cache entry. */
  invalidate(key: string): boolean {
    return this.cache.delete(key);
  }

  /** Invalidate all entries whose keys contain the given substring. */
  invalidateMatching(substring: string): number {
    let count = 0;
    for (const key of this.cache.keys()) {
      if (key.includes(substring)) {
        this.cache.delete(key);
        count++;
      }
    }
    return count;
  }

  /** Clear the entire cache. */
  clear(): void {
    this.cache.clear();
  }

  /** Number of entries currently in the cache (including potentially expired). */
  get size(): number {
    return this.cache.size;
  }
}
