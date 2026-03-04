import { describe, expect, it } from 'vitest';
import { apiHeaders } from '../../src/hooks/shared.js';

describe('apiHeaders', () => {
  it('returns x-api-key header', () => {
    const headers = apiHeaders({ apiUrl: 'http://localhost', apiKey: 'key-123' });
    expect(headers['x-api-key']).toBe('key-123');
    expect(headers['X-Org-Id']).toBeUndefined();
  });

  it('includes X-Org-Id when orgId is set', () => {
    const headers = apiHeaders({ apiUrl: 'http://localhost', apiKey: 'key-123', orgId: 'org-abc' });
    expect(headers['x-api-key']).toBe('key-123');
    expect(headers['X-Org-Id']).toBe('org-abc');
  });

  it('omits X-Org-Id when orgId is undefined', () => {
    const headers = apiHeaders({ apiUrl: 'http://localhost', apiKey: 'key-123', orgId: undefined });
    expect(headers['X-Org-Id']).toBeUndefined();
  });
});
