import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDashboardApp } from '../../src/dashboard/server.js';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('Dashboard Server', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'entendi-dash-'));
    mkdirSync(join(tmpDir, '.entendi'), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('GET /api/graph returns knowledge graph state', async () => {
    writeFileSync(
      join(tmpDir, '.entendi', 'knowledge-graph.json'),
      JSON.stringify({
        concepts: {
          react: {
            conceptId: 'react',
            domain: 'frontend',
            specificity: 'topic',
            aliases: [],
            parentConcept: null,
            itemParams: { discrimination: 1, thresholds: [-1, 0, 1] },
            relationships: [],
            lifecycle: 'stable',
            populationStats: {
              meanMastery: 0,
              assessmentCount: 0,
              failureRate: 0,
            },
          },
        },
        userStates: {},
      }),
    );

    const app = createDashboardApp(tmpDir);
    const res = await app.request('/api/graph');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.concepts).toBeDefined();
    expect(data.concepts['react']).toBeDefined();
  });

  it('GET /api/graph returns empty state when no files exist', async () => {
    const emptyDir = mkdtempSync(join(tmpdir(), 'entendi-dash-empty-'));
    try {
      const app = createDashboardApp(emptyDir);
      const res = await app.request('/api/graph');
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.concepts).toEqual({});
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  it('GET / returns HTML page', async () => {
    const app = createDashboardApp(tmpDir);
    const res = await app.request('/');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Entendi');
    expect(html).toContain('<html');
  });

  it('GET /api/stats returns summary statistics', async () => {
    const app = createDashboardApp(tmpDir);
    const res = await app.request('/api/stats');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('totalConcepts');
    expect(data).toHaveProperty('totalUsers');
    expect(data).toHaveProperty('totalAssessments');
  });

  it('GET /api/stats counts concepts and users correctly', async () => {
    writeFileSync(
      join(tmpDir, '.entendi', 'knowledge-graph.json'),
      JSON.stringify({
        concepts: {
          react: {
            conceptId: 'react',
            domain: 'frontend',
            specificity: 'topic',
            aliases: [],
            parentConcept: null,
            itemParams: { discrimination: 1, thresholds: [-1, 0, 1] },
            relationships: [],
            lifecycle: 'stable',
            populationStats: {
              meanMastery: 0,
              assessmentCount: 0,
              failureRate: 0,
            },
          },
          typescript: {
            conceptId: 'typescript',
            domain: 'language',
            specificity: 'domain',
            aliases: ['ts'],
            parentConcept: null,
            itemParams: { discrimination: 1, thresholds: [-1, 0, 1] },
            relationships: [],
            lifecycle: 'stable',
            populationStats: {
              meanMastery: 0,
              assessmentCount: 0,
              failureRate: 0,
            },
          },
        },
        userStates: {
          'user1:react': {
            conceptId: 'react',
            userId: 'user1',
            mastery: { mu: 1.5, sigma: 0.8 },
            memory: { stability: 2.0, difficulty: 4.5 },
            lastAssessed: '2026-02-25T10:00:00Z',
            assessmentCount: 3,
            history: [],
          },
          'user1:typescript': {
            conceptId: 'typescript',
            userId: 'user1',
            mastery: { mu: 0.5, sigma: 1.0 },
            memory: { stability: 1.5, difficulty: 5.0 },
            lastAssessed: '2026-02-25T09:00:00Z',
            assessmentCount: 2,
            history: [],
          },
        },
      }),
    );

    const app = createDashboardApp(tmpDir);
    const res = await app.request('/api/stats');
    const data = await res.json();
    expect(data.totalConcepts).toBe(2);
    expect(data.totalUsers).toBe(1);
    expect(data.totalAssessments).toBe(5);
  });

  it('GET /api/graph handles malformed JSON gracefully', async () => {
    writeFileSync(
      join(tmpDir, '.entendi', 'knowledge-graph.json'),
      'not valid json {{{',
    );

    const app = createDashboardApp(tmpDir);
    const res = await app.request('/api/graph');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.concepts).toEqual({});
    expect(data.userStates).toEqual({});
  });

  it('HTML page does not use innerHTML', async () => {
    const app = createDashboardApp(tmpDir);
    const res = await app.request('/');
    const html = await res.text();
    expect(html).not.toContain('innerHTML');
  });
});
