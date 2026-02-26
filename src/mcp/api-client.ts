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

export interface ApiClientOptions {
  apiUrl: string;
  apiKey: string;
}

export class EntendiApiClient {
  private apiUrl: string;
  private apiKey: string;

  constructor(options: ApiClientOptions) {
    this.apiUrl = options.apiUrl.replace(/\/$/, '');
    this.apiKey = options.apiKey;
    apiLog('initialized', { apiUrl: this.apiUrl });
  }

  private async request(method: string, path: string, body?: unknown): Promise<any> {
    const url = `${this.apiUrl}${path}`;
    const init: RequestInit = {
      method,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
      },
    };
    if (body) {
      init.body = JSON.stringify(body);
    }
    apiLog(`${method} ${path}`, body ? { body } : undefined);
    const start = Date.now();
    const res = await fetch(url, init);

    if (!res.ok) {
      const text = await res.text();
      apiLog(`${method} ${path} FAILED`, { status: res.status, elapsed: Date.now() - start, error: text });
      throw new Error(`API ${method} ${path} failed (${res.status}): ${text}`);
    }

    const result = await res.json();
    apiLog(`${method} ${path} OK`, { status: res.status, elapsed: Date.now() - start, result });
    return result;
  }

  async observe(input: {
    concepts: Array<{ id: string; source: 'package' | 'ast' | 'llm' }>;
    triggerContext: string;
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

  async dismiss(input?: { reason?: 'user_declined' | 'topic_changed' | 'timeout' }) {
    return this.request('POST', '/api/mcp/dismiss', input ?? {});
  }

  async getStatus(conceptId?: string) {
    const query = conceptId ? `?conceptId=${encodeURIComponent(conceptId)}` : '';
    return this.request('GET', `/api/mcp/status${query}`);
  }

  async getZpdFrontier() {
    return this.request('GET', '/api/mcp/zpd-frontier');
  }
}
