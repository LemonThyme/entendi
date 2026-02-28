/**
 * HTTP client for the Entendi API. Replaces StateManager for the MCP server,
 * delegating all state operations to the production API.
 */
import { appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

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
  const exponentialDelay = baseDelayMs * Math.pow(2, attempt);
  const jitter = exponentialDelay * jitterFactor * (2 * Math.random() - 1); // ±jitterFactor
  return Math.max(0, exponentialDelay + jitter);
}

export class EntendiApiClient {
  private apiUrl: string;
  private apiKey: string;
  private maxRetries: number;
  private baseDelayMs: number;
  private jitterFactor: number;
  private defaultTimeoutMs: number;

  constructor(options: ApiClientOptions) {
    this.apiUrl = options.apiUrl.replace(/\/$/, '');
    this.apiKey = options.apiKey;
    this.maxRetries = options.retry?.maxRetries ?? 3;
    this.baseDelayMs = options.retry?.baseDelayMs ?? 1000;
    this.jitterFactor = options.retry?.jitterFactor ?? 0.25;
    this.defaultTimeoutMs = options.retry?.timeoutMs ?? 10_000;
    apiLog('initialized', { apiUrl: this.apiUrl, maxRetries: this.maxRetries, timeoutMs: this.defaultTimeoutMs });
  }

  getApiUrl(): string {
    return this.apiUrl;
  }

  private async request(method: string, path: string, body?: unknown, opts?: { timeoutMs?: number }): Promise<any> {
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
        return result;
      } catch (err) {
        clearTimeout(timer);

        // Convert AbortError to a timeout error
        if (err instanceof Error && err.name === 'AbortError') {
          lastError = new Error(`API ${method} ${path} timed out after ${timeoutMs}ms`);
          apiLog(`${method} ${path} TIMEOUT`, { timeoutMs, attempt });
          if (attempt < this.maxRetries) continue;
          throw lastError;
        }

        // Retry on transient network errors
        if (isNetworkError(err) && attempt < this.maxRetries) {
          lastError = err instanceof Error ? err : new Error(String(err));
          apiLog(`${method} ${path} NETWORK_ERROR`, { error: String(err), attempt });
          continue;
        }

        // Non-retryable or exhausted retries
        throw err;
      }
    }

    // Should not reach here, but just in case
    throw lastError ?? new Error(`API ${method} ${path} failed after ${this.maxRetries} retries`);
  }

  async observe(input: {
    concepts: Array<{ id: string; source: 'package' | 'ast' | 'llm' }>;
    triggerContext: string;
    primaryConceptId?: string;
  }) {
    return this.request('POST', '/api/mcp/observe', input);
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
    return this.request('POST', '/api/mcp/record-evaluation', input);
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
    return this.request('POST', '/api/mcp/tutor/advance', input);
  }

  async dismiss(input: { reason: 'topic_change' | 'busy' | 'claimed_expertise'; note?: string }) {
    return this.request('POST', '/api/mcp/dismiss', input);
  }

  async getStatus(conceptId?: string) {
    const query = conceptId ? `?conceptId=${encodeURIComponent(conceptId)}` : '';
    return this.request('GET', `/api/mcp/status${query}`);
  }

  async getZpdFrontier() {
    return this.request('GET', '/api/mcp/zpd-frontier');
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
