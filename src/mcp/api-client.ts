/**
 * HTTP client for the Entendi API. Replaces StateManager for the MCP server,
 * delegating all state operations to the production API.
 */

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
    const res = await fetch(url, init);

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`API ${method} ${path} failed (${res.status}): ${text}`);
    }

    return res.json();
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
