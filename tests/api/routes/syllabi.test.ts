import { config } from 'dotenv';

config();

import { describe, expect, it } from 'vitest';
import { createApp } from '../../../src/api/index.js';

const testDbUrl = process.env.DATABASE_URL;
const testApiKey = process.env.ENTENDI_API_KEY;
const testSecret = process.env.BETTER_AUTH_SECRET;
const canRun = testDbUrl && testApiKey && testSecret && process.env.INTEGRATION_TESTS === '1';
const describeWithDb = canRun ? describe : describe.skip;

describeWithDb('Syllabi API routes (integration)', () => {
  const { app, db } = createApp(testDbUrl!, { secret: testSecret! });
  const headers = { 'Content-Type': 'application/json', 'x-api-key': testApiKey! };

  let syllabusId: string;
  let sourceId: string;
  const testConceptId = 'react-hooks'; // known seeded concept

  // --- POST / (create syllabus) ---

  it('POST /api/syllabi requires auth', async () => {
    const res = await app.request('/api/syllabi', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test Syllabus' }),
    });
    expect(res.status).toBe(401);
  });

  it('POST /api/syllabi validates name is required', async () => {
    const res = await app.request('/api/syllabi', {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toBe('Validation error');
  });

  it('POST /api/syllabi creates a syllabus', async () => {
    const res = await app.request('/api/syllabi', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Intro to TypeScript', description: 'Learn TS basics' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.id).toBeDefined();
    expect(body.name).toBe('Intro to TypeScript');
    expect(body.description).toBe('Learn TS basics');
    expect(body.status).toBe('draft');
    syllabusId = body.id;
  });

  // --- GET / (list syllabi) ---

  it('GET /api/syllabi requires auth', async () => {
    const res = await app.request('/api/syllabi');
    expect(res.status).toBe(401);
  });

  it('GET /api/syllabi lists syllabi for active org', async () => {
    const res = await app.request('/api/syllabi', { headers });
    expect(res.status).toBe(200);
    const body = await res.json() as any[];
    expect(Array.isArray(body)).toBe(true);
    const found = body.find((s: any) => s.id === syllabusId);
    expect(found).toBeDefined();
    expect(found.name).toBe('Intro to TypeScript');
  });

  // --- GET /:id (syllabus detail) ---

  it('GET /api/syllabi/:id requires auth', async () => {
    const res = await app.request(`/api/syllabi/${syllabusId}`);
    expect(res.status).toBe(401);
  });

  it('GET /api/syllabi/:id returns detail with sources and counts', async () => {
    const res = await app.request(`/api/syllabi/${syllabusId}`, { headers });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.id).toBe(syllabusId);
    expect(body.name).toBe('Intro to TypeScript');
    expect(Array.isArray(body.sources)).toBe(true);
    expect(typeof body.conceptCount).toBe('number');
    expect(typeof body.enrollmentCount).toBe('number');
  });

  it('GET /api/syllabi/:id returns 404 for nonexistent', async () => {
    const res = await app.request('/api/syllabi/nonexistent-id', { headers });
    expect(res.status).toBe(404);
  });

  // --- PUT /:id (update syllabus) ---

  it('PUT /api/syllabi/:id requires auth', async () => {
    const res = await app.request(`/api/syllabi/${syllabusId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Updated' }),
    });
    expect(res.status).toBe(401);
  });

  it('PUT /api/syllabi/:id updates fields', async () => {
    const res = await app.request(`/api/syllabi/${syllabusId}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ name: 'Advanced TypeScript', status: 'active' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.name).toBe('Advanced TypeScript');
    expect(body.status).toBe('active');
  });

  it('PUT /api/syllabi/:id returns 404 for nonexistent', async () => {
    const res = await app.request('/api/syllabi/nonexistent-id', {
      method: 'PUT',
      headers,
      body: JSON.stringify({ name: 'Nope' }),
    });
    expect(res.status).toBe(404);
  });

  // --- POST /:id/sources (add source) ---

  it('POST /api/syllabi/:id/sources requires auth', async () => {
    const res = await app.request(`/api/syllabi/${syllabusId}/sources`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceType: 'url', sourceUrl: 'https://example.com/syllabus.pdf' }),
    });
    expect(res.status).toBe(401);
  });

  it('POST /api/syllabi/:id/sources validates sourceType', async () => {
    const res = await app.request(`/api/syllabi/${syllabusId}/sources`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ sourceType: 'invalid' }),
    });
    expect(res.status).toBe(400);
  });

  it('POST /api/syllabi/:id/sources adds a source', async () => {
    const res = await app.request(`/api/syllabi/${syllabusId}/sources`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ sourceType: 'url', sourceUrl: 'https://example.com/syllabus.pdf' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.id).toBeDefined();
    expect(body.sourceType).toBe('url');
    expect(body.sourceUrl).toBe('https://example.com/syllabus.pdf');
    expect(body.extractionStatus).toBe('pending');
    sourceId = body.id;
  });

  it('POST /api/syllabi/:id/sources returns 404 for nonexistent syllabus', async () => {
    const res = await app.request('/api/syllabi/nonexistent-id/sources', {
      method: 'POST',
      headers,
      body: JSON.stringify({ sourceType: 'manual' }),
    });
    expect(res.status).toBe(404);
  });

  it('GET /api/syllabi/:id includes added source', async () => {
    const res = await app.request(`/api/syllabi/${syllabusId}`, { headers });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.sources.length).toBeGreaterThan(0);
    const found = body.sources.find((s: any) => s.id === sourceId);
    expect(found).toBeDefined();
  });

  // --- DELETE /:id/sources/:sourceId (remove source) ---

  it('DELETE /api/syllabi/:id/sources/:sourceId removes source', async () => {
    const res = await app.request(`/api/syllabi/${syllabusId}/sources/${sourceId}`, {
      method: 'DELETE',
      headers,
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.deleted).toBe(true);
  });

  it('DELETE /api/syllabi/:id/sources/:sourceId returns 404 for nonexistent', async () => {
    const res = await app.request(`/api/syllabi/${syllabusId}/sources/nonexistent-id`, {
      method: 'DELETE',
      headers,
    });
    expect(res.status).toBe(404);
  });

  // --- POST /:id/concepts (add concept) ---

  it('POST /api/syllabi/:id/concepts requires auth', async () => {
    const res = await app.request(`/api/syllabi/${syllabusId}/concepts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conceptId: testConceptId }),
    });
    expect(res.status).toBe(401);
  });

  it('POST /api/syllabi/:id/concepts validates input', async () => {
    const res = await app.request(`/api/syllabi/${syllabusId}/concepts`, {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('POST /api/syllabi/:id/concepts returns 404 for nonexistent syllabus', async () => {
    const res = await app.request('/api/syllabi/nonexistent-id/concepts', {
      method: 'POST',
      headers,
      body: JSON.stringify({ conceptId: testConceptId }),
    });
    expect(res.status).toBe(404);
  });

  it('POST /api/syllabi/:id/concepts returns 404 for nonexistent concept', async () => {
    const res = await app.request(`/api/syllabi/${syllabusId}/concepts`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ conceptId: 'nonexistent-concept-xyz' }),
    });
    expect(res.status).toBe(404);
  });

  it('POST /api/syllabi/:id/concepts adds a concept', async () => {
    const res = await app.request(`/api/syllabi/${syllabusId}/concepts`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        conceptId: testConceptId,
        importance: 'core',
        learningObjective: 'Understand React hooks lifecycle',
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.conceptId).toBe(testConceptId);
    expect(body.syllabusId).toBe(syllabusId);
    expect(body.importance).toBe('core');
    expect(body.learningObjective).toBe('Understand React hooks lifecycle');
    expect(body.autoExtracted).toBe(false);
  });

  // --- DELETE /:id/concepts/:conceptId (remove concept) ---

  it('DELETE /api/syllabi/:id/concepts/:conceptId removes concept', async () => {
    const res = await app.request(`/api/syllabi/${syllabusId}/concepts/${testConceptId}`, {
      method: 'DELETE',
      headers,
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.deleted).toBe(true);
  });

  it('DELETE /api/syllabi/:id/concepts/:conceptId returns 404 for nonexistent', async () => {
    const res = await app.request(`/api/syllabi/${syllabusId}/concepts/nonexistent-concept`, {
      method: 'DELETE',
      headers,
    });
    expect(res.status).toBe(404);
  });

  // Re-add concept for progress tests
  it('re-add concept for progress tests', async () => {
    const res = await app.request(`/api/syllabi/${syllabusId}/concepts`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ conceptId: testConceptId, importance: 'core' }),
    });
    expect(res.status).toBe(201);
  });

  // --- POST /:id/enroll (self-enroll) ---

  it('POST /api/syllabi/:id/enroll requires auth', async () => {
    const res = await app.request(`/api/syllabi/${syllabusId}/enroll`, {
      method: 'POST',
    });
    expect(res.status).toBe(401);
  });

  it('POST /api/syllabi/:id/enroll returns 404 for nonexistent syllabus', async () => {
    const res = await app.request('/api/syllabi/nonexistent-id/enroll', {
      method: 'POST',
      headers,
    });
    expect(res.status).toBe(404);
  });

  it('POST /api/syllabi/:id/enroll enrolls the user', async () => {
    const res = await app.request(`/api/syllabi/${syllabusId}/enroll`, {
      method: 'POST',
      headers,
    });
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.syllabusId).toBe(syllabusId);
    expect(body.userId).toBeDefined();
  });

  it('POST /api/syllabi/:id/enroll rejects duplicate enrollment', async () => {
    const res = await app.request(`/api/syllabi/${syllabusId}/enroll`, {
      method: 'POST',
      headers,
    });
    expect(res.status).toBe(409);
    const body = await res.json() as any;
    expect(body.error).toContain('Already enrolled');
  });

  // --- GET /:id/progress (own progress) ---

  it('GET /api/syllabi/:id/progress requires auth', async () => {
    const res = await app.request(`/api/syllabi/${syllabusId}/progress`);
    expect(res.status).toBe(401);
  });

  it('GET /api/syllabi/:id/progress returns 404 for nonexistent syllabus', async () => {
    const res = await app.request('/api/syllabi/nonexistent-id/progress', { headers });
    expect(res.status).toBe(404);
  });

  it('GET /api/syllabi/:id/progress returns own progress', async () => {
    const res = await app.request(`/api/syllabi/${syllabusId}/progress`, { headers });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.syllabusId).toBe(syllabusId);
    expect(body.userId).toBeDefined();
    expect(Array.isArray(body.concepts)).toBe(true);
    expect(body.concepts.length).toBeGreaterThan(0);

    const cp = body.concepts[0];
    expect(typeof cp.conceptId).toBe('string');
    expect(typeof cp.mastery).toBe('number');
    expect(typeof cp.threshold).toBe('number');
    expect(typeof cp.met).toBe('boolean');
    expect(cp.importance).toBe('core');
    expect(cp.threshold).toBe(0.8); // core threshold

    expect(typeof body.completionRatio).toBe('number');
    expect(body.completionRatio).toBeGreaterThanOrEqual(0);
    expect(body.completionRatio).toBeLessThanOrEqual(1);
  });

  // --- GET /:id/progress/:userId (member progress) ---

  it('GET /api/syllabi/:id/progress/:userId returns member progress', async () => {
    const meRes = await app.request('/api/me', { headers });
    const me = await meRes.json() as any;
    const userId = me.user.id;

    const res = await app.request(`/api/syllabi/${syllabusId}/progress/${userId}`, { headers });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.syllabusId).toBe(syllabusId);
    expect(body.userId).toBe(userId);
    expect(Array.isArray(body.concepts)).toBe(true);
  });

  it('GET /api/syllabi/:id/progress/:userId returns 404 for nonexistent syllabus', async () => {
    const res = await app.request('/api/syllabi/nonexistent-id/progress/some-user', { headers });
    expect(res.status).toBe(404);
  });

  // --- DELETE /:id (delete syllabus) ---

  it('DELETE /api/syllabi/:id requires auth', async () => {
    const res = await app.request(`/api/syllabi/${syllabusId}`, {
      method: 'DELETE',
    });
    expect(res.status).toBe(401);
  });

  it('DELETE /api/syllabi/:id returns 404 for nonexistent', async () => {
    const res = await app.request('/api/syllabi/nonexistent-id', {
      method: 'DELETE',
      headers,
    });
    expect(res.status).toBe(404);
  });

  it('DELETE /api/syllabi/:id deletes the syllabus', async () => {
    const res = await app.request(`/api/syllabi/${syllabusId}`, {
      method: 'DELETE',
      headers,
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.deleted).toBe(true);
  });

  it('GET /api/syllabi/:id returns 404 after deletion', async () => {
    const res = await app.request(`/api/syllabi/${syllabusId}`, { headers });
    expect(res.status).toBe(404);
  });
});
