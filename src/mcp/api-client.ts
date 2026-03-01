/**
 * HTTP client for the Entendi API. Replaces StateManager for the MCP server,
 * delegating all state operations to the production API.
 *
 * Includes:
 * - Retry with exponential backoff and jitter
 * - Circuit breaker (fail-fast after consecutive failures)
 * - In-memory response cache for read-only endpoints
 */
import { appendFileSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { ResponseCache } from './response-cache.js';

const LOG_DIR = join(homedir(), '.entendi');
const LOG_FILE = join(LOG_DIR, 'debug.log');
let logReady = false;

function apiLog(message: string, data?: unknown): void {
  if (!logReady) {
    try { mkdirSync(LOG_DIR, { recursive: true }); } catch {}
    logReady = true;
  }
  const ts = new Date().toISOString();
  const dataStr = data !== undefined ? ` ${JSON.stringify(data)}` : '';
  try {
    appendFileSync(LOG_FILE, `[${ts}] [api-client] ${message}${dataStr}\n`);
  } catch {}
}

// ---------------------------------------------------------------------------
// Circuit breaker
// ---------------------------------------------------------------------------

/** Circuit breaker states. */
export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerOptions {
  /** Number of consecutive failures before opening the circuit (default: 5). */
  failureThreshold?: number;
  /** Cooldown in ms before allowing a half-open probe request (default: 30_000). */
  cooldownMs?: number;
}

export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private consecutiveFailures = 0;
  private openedAt = 0;
  readonly failureThreshold: number;
  readonly cooldownMs: number;

  constructor(options?: CircuitBreakerOptions) {
    this.failureThreshold = options?.failureThreshold ?? 5;
    this.cooldownMs = options?.cooldownMs ?? 30_000;
  }

  /** Current circuit state. */
  getState(): CircuitState {
    // Auto-transition from open -> half-open after cooldown
    if (this.state === 'open' && Date.now() - this.openedAt >= this.cooldownMs) {
      this.transitionTo('half-open');
    }
    return this.state;
  }

  /** Check whether a request is allowed. Returns true if allowed. */
  allowRequest(): boolean {
    const current = this.getState();
    return current === 'closed' || current === 'half-open';
  }

  /** Record a successful request. Resets the breaker to closed. */
  recordSuccess(): void {
    if (this.state !== 'closed') {
      this.transitionTo('closed');
    }
    this.consecutiveFailures = 0;
  }

  /** Record a failed request. May open the circuit. */
  recordFailure(): void {
    this.consecutiveFailures++;
    if (this.state === 'half-open') {
      // Half-open probe failed — reopen
      this.transitionTo('open');
    } else if (this.consecutiveFailures >= this.failureThreshold) {
      this.transitionTo('open');
    }
  }

  /** Number of consecutive failures. */
  getConsecutiveFailures(): number {
    return this.consecutiveFailures;
  }

  private transitionTo(newState: CircuitState): void {
    const prev = this.state;
    this.state = newState;
    if (newState === 'open') {
      this.openedAt = Date.now();
    }
    if (newState === 'closed') {
      this.consecutiveFailures = 0;
    }
    apiLog(`circuit-breaker ${prev} -> ${newState}`, {
      consecutiveFailures: this.consecutiveFailures,
    });
  }
}

// ---------------------------------------------------------------------------
// Retry helpers
// ---------------------------------------------------------------------------

/** Retry and timeout configuration for API requests. */
export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3). */
  maxRetries?: number;
  /** Base delay in ms for exponential backoff (default: 1000). */
  baseDelayMs?: number;
  /** Jitter factor as a fraction of the delay, e.g. 0.25 = ±25% (default: 0.25). */
  jitterFactor?: number;
  /** Request timeout in ms (default: 10000). */
  timeoutMs?: number;
}

export interface ApiClientOptions {
  apiUrl: string;
  apiKey: string;
  retry?: RetryOptions;
  circuitBreaker?: CircuitBreakerOptions;
  /** TTL in ms for the read-only response cache (default: 60_000). */
  cacheTtlMs?: number;
}

/** Check if an HTTP status code is retryable. */
function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

/** Check if an error is a transient network error worth retrying. */
function isNetworkError(err: unknown): boolean {
  if (err instanceof TypeError) return true; // fetch network errors
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    return msg.includes('fetch') || msg.includes('network') || msg.includes('econnrefused')
      || msg.includes('econnreset') || msg.includes('etimedout') || msg.includes('abort');
  }
  return false;
}

/** Compute delay with exponential backoff and jitter. */
function computeBackoffDelay(attempt: number, baseDelayMs: number, jitterFactor: number): number {
  const exponentialDelay = baseDelayMs * 2 ** attempt;
  const jitter = exponentialDelay * jitterFactor * (2 * Math.random() - 1); // ±jitterFactor
  return Math.max(0, exponentialDelay + jitter);
}

// ---------------------------------------------------------------------------
// API Client
// ---------------------------------------------------------------------------

export class EntendiApiClient {
  private apiUrl: string;
  private apiKey: string;
  private maxRetries: number;
  private baseDelayMs: number;
  private jitterFactor: number;
  private defaultTimeoutMs: number;
  private circuitBreaker: CircuitBreaker;
  private cache: ResponseCache;

  constructor(options: ApiClientOptions) {
    this.apiUrl = options.apiUrl.replace(/\/$/, '');
    this.apiKey = options.apiKey;
    this.maxRetries = options.retry?.maxRetries ?? 3;
    this.baseDelayMs = options.retry?.baseDelayMs ?? 1000;
    this.jitterFactor = options.retry?.jitterFactor ?? 0.25;
    this.defaultTimeoutMs = options.retry?.timeoutMs ?? 10_000;
    this.circuitBreaker = new CircuitBreaker(options.circuitBreaker);
    this.cache = new ResponseCache({ ttlMs: options.cacheTtlMs ?? 60_000 });
    apiLog('initialized', { apiUrl: this.apiUrl, maxRetries: this.maxRetries, timeoutMs: this.defaultTimeoutMs });
  }

  getApiUrl(): string {
    return this.apiUrl;
  }

  /** Expose circuit breaker for testing / monitoring. */
  getCircuitBreaker(): CircuitBreaker {
    return this.circuitBreaker;
  }

  /** Expose cache for testing / monitoring. */
  getCache(): ResponseCache {
    return this.cache;
  }

  private async request(method: string, path: string, body?: unknown, opts?: { timeoutMs?: number }): Promise<any> {
    // --- Circuit breaker check ---
    if (!this.circuitBreaker.allowRequest()) {
      const msg = `Circuit breaker OPEN — failing fast for ${method} ${path}`;
      apiLog(msg);
      throw new Error(msg);
    }

    const url = `${this.apiUrl}${path}`;
    const timeoutMs = opts?.timeoutMs ?? this.defaultTimeoutMs;

    apiLog(`${method} ${path}`, body ? { body } : undefined);
    const overallStart = Date.now();

    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) {
        const delay = computeBackoffDelay(attempt - 1, this.baseDelayMs, this.jitterFactor);
        apiLog(`${method} ${path} retry ${attempt}/${this.maxRetries} after ${Math.round(delay)}ms`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }

      // Set up AbortController for this attempt
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const init: RequestInit = {
          method,
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': this.apiKey,
          },
          signal: controller.signal,
        };
        if (body) {
          init.body = JSON.stringify(body);
        }

        const start = Date.now();
        const res = await fetch(url, init);
        clearTimeout(timer);

        if (!res.ok) {
          const text = await res.text();
          const elapsed = Date.now() - start;
          apiLog(`${method} ${path} FAILED`, { status: res.status, elapsed, attempt, error: text });

          // Determine if we should retry
          if (isRetryableStatus(res.status) && attempt < this.maxRetries) {
            lastError = new Error(`API ${method} ${path} failed (${res.status}): ${text}`);
            continue;
          }

          // Record failure for circuit breaker (only for server/network errors)
          if (isRetryableStatus(res.status)) {
            this.circuitBreaker.recordFailure();
          }

          // Non-retryable 4xx or exhausted retries
          throw new Error(`API ${method} ${path} failed (${res.status}): ${text}`);
        }

        const result = await res.json();
        const elapsed = Date.now() - overallStart;
        if (attempt > 0) {
          apiLog(`${method} ${path} OK after ${attempt} retries`, { status: res.status, elapsed, result });
        } else {
          apiLog(`${method} ${path} OK`, { status: res.status, elapsed, result });
        }

        // Record success for circuit breaker
        this.circuitBreaker.recordSuccess();

        return result;
      } catch (err) {
        clearTimeout(timer);

        // Convert AbortError to a timeout error
        if (err instanceof Error && err.name === 'AbortError') {
          lastError = new Error(`API ${method} ${path} timed out after ${timeoutMs}ms`);
          apiLog(`${method} ${path} TIMEOUT`, { timeoutMs, attempt });
          if (attempt < this.maxRetries) continue;
          this.circuitBreaker.recordFailure();
          throw lastError;
        }

        // Retry on transient network errors
        if (isNetworkError(err) && attempt < this.maxRetries) {
          lastError = err instanceof Error ? err : new Error(String(err));
          apiLog(`${method} ${path} NETWORK_ERROR`, { error: String(err), attempt });
          continue;
        }

        // Record failure for circuit breaker on network errors
        if (isNetworkError(err)) {
          this.circuitBreaker.recordFailure();
        }

        // Non-retryable or exhausted retries
        throw err;
      }
    }

    // Should not reach here, but just in case
    this.circuitBreaker.recordFailure();
    throw lastError ?? new Error(`API ${method} ${path} failed after ${this.maxRetries} retries`);
  }

  async observe(input: {
    concepts: Array<{ id: string; source: 'package' | 'ast' | 'llm' }>;
    triggerContext: string;
    primaryConceptId?: string;
  }) {
    const result = await this.request('POST', '/api/mcp/observe', input);
    // Invalidate status cache after observe (new concepts may have been created)
    this.cache.invalidateMatching('/api/mcp/status');
    this.cache.invalidateMatching('/api/mcp/zpd-frontier');
    return result;
  }

  async recordEvaluation(input: {
    conceptId: string;
    score: 0 | 1 | 2 | 3;
    confidence: number;
    reasoning: string;
    eventType: 'probe' | 'tutor_phase1' | 'tutor_phase4';
    probeToken?: {
      tokenId: string;
      userId: string;
      conceptId: string;
      depth: number;
      evaluationCriteria: string;
      issuedAt: string;
      expiresAt: string;
      signature: string;
    };
    responseText?: string;
  }) {
    const result = await this.request('POST', '/api/mcp/record-evaluation', input);
    // Invalidate status cache for the evaluated concept and zpd-frontier
    this.cache.invalidateMatching('/api/mcp/status');
    this.cache.invalidateMatching('/api/mcp/zpd-frontier');
    return result;
  }

  async startTutor(input: {
    conceptId: string;
    triggerScore?: 0 | 1 | null;
  }) {
    return this.request('POST', '/api/mcp/tutor/start', input);
  }

  async advanceTutor(input: {
    sessionId: string;
    userResponse: string;
    score?: 0 | 1 | 2 | 3;
    confidence?: number;
    reasoning?: string;
    misconception?: string;
  }) {
    const result = await this.request('POST', '/api/mcp/tutor/advance', input);
    // Tutor advance may update mastery
    this.cache.invalidateMatching('/api/mcp/status');
    this.cache.invalidateMatching('/api/mcp/zpd-frontier');
    return result;
  }

  async dismiss(input: { reason: 'topic_change' | 'busy' | 'claimed_expertise'; note?: string }) {
    return this.request('POST', '/api/mcp/dismiss', input);
  }

  async getStatus(conceptId?: string) {
    const query = conceptId ? `?conceptId=${encodeURIComponent(conceptId)}` : '';
    const path = `/api/mcp/status${query}`;
    const cacheKey = ResponseCache.key('GET', path);

    // Check cache first
    const cached = this.cache.get(cacheKey);
    if (cached !== undefined) {
      apiLog(`GET ${path} CACHE_HIT`);
      return cached;
    }

    const result = await this.request('GET', path);
    this.cache.set(cacheKey, result);
    return result;
  }

  async getZpdFrontier(params?: { limit?: number; domain?: string; includeUnassessed?: boolean }) {
    const query = new URLSearchParams();
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.domain) query.set('domain', params.domain);
    if (params?.includeUnassessed) query.set('includeUnassessed', 'true');
    const qs = query.toString();
    const path = `/api/mcp/zpd-frontier${qs ? `?${qs}` : ''}`;
    const cacheKey = ResponseCache.key('GET', path);

    const cached = this.cache.get(cacheKey);
    if (cached !== undefined) {
      apiLog(`GET ${path} CACHE_HIT`);
      return cached;
    }

    const result = await this.request('GET', path);
    this.cache.set(cacheKey, result);
    return result;
  }

  /** Check API health (no auth required). Returns { status, db } from /health. */
  async healthCheck(): Promise<{ status: string; db: string; error?: string }> {
    const url = `${this.apiUrl}/health`;
    apiLog('GET /health (unauthenticated)');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.defaultTimeoutMs);
    try {
      const res = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
      });
      clearTimeout(timer);
      return res.json() as Promise<{ status: string; db: string; error?: string }>;
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(`Health check timed out after ${this.defaultTimeoutMs}ms`);
      }
      throw err;
    }
  }

  /** Verify auth by calling /api/me. Returns user info or throws. */
  async verifyAuth(): Promise<{ user: Record<string, unknown> }> {
    return this.request('GET', '/api/me');
  }

  /** Create a device code for CLI-first auth (no auth required). */
  async createDeviceCode(): Promise<{ code: string; verifyUrl: string; expiresAt: string }> {
    const url = `${this.apiUrl}/api/auth/device-code`;
    apiLog('POST /api/auth/device-code (unauthenticated)');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.defaultTimeoutMs);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Device code creation failed (${res.status}): ${text}`);
      }
      return res.json() as Promise<{ code: string; verifyUrl: string; expiresAt: string }>;
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(`Device code creation timed out after ${this.defaultTimeoutMs}ms`);
      }
      throw err;
    }
  }

  /** Poll device code status (no auth required). */
  async pollDeviceCode(code: string): Promise<{ status: string; apiKey?: string }> {
    const url = `${this.apiUrl}/api/auth/device-code/${encodeURIComponent(code)}`;
    apiLog(`GET /api/auth/device-code/${code} (unauthenticated)`);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.defaultTimeoutMs);
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Device code poll failed (${res.status}): ${text}`);
      }
      return res.json() as Promise<{ status: string; apiKey?: string }>;
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(`Device code poll timed out after ${this.defaultTimeoutMs}ms`);
      }
      throw err;
    }
  }
}
