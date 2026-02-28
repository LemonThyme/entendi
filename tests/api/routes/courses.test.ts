import { config } from 'dotenv';

config();

import { describe, expect, it } from 'vitest';
import { createApp } from '../../../src/api/index.js';

const testDbUrl = process.env.DATABASE_URL;
const testApiKey = process.env.ENTENDI_API_KEY;
const testSecret = process.env.BETTER_AUTH_SECRET;
// Integration tests require matching API key + secret + DB. Only run when explicitly opted in.
const canRun = testDbUrl && testApiKey && testSecret && process.env.INTEGRATION_TESTS === '1';
const describeWithDb = canRun ? describe : describe.skip;

describeWithDb('Course API routes (integration)', () => {
  const { app } = createApp(testDbUrl!, { secret: testSecret! });
  const headers = { 'Content-Type': 'application/json', 'x-api-key': testApiKey! };

  let courseId: string;
  const testConceptId = 'react-hooks'; // known seeded concept

  // --- POST / (create course) ---

  it('POST /api/courses requires auth', async () => {
    const res = await app.request('/api/courses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test Course' }),
    });
    expect(res.status).toBe(401);
  });

  it('POST /api/courses validates name is required', async () => {
    const res = await app.request('/api/courses', {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toBe('Validation error');
  });

  it('POST /api/courses creates a course', async () => {
    const res = await app.request('/api/courses', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Intro to React', description: 'Learn React basics' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.id).toBeDefined();
    expect(body.name).toBe('Intro to React');
    expect(body.description).toBe('Learn React basics');
    expect(body.status).toBe('draft');
    courseId = body.id;
  });

  // --- GET / (list courses) ---

  it('GET /api/courses requires auth', async () => {
    const res = await app.request('/api/courses');
    expect(res.status).toBe(401);
  });

  it('GET /api/courses lists courses owned by the user', async () => {
    const res = await app.request('/api/courses', { headers });
    expect(res.status).toBe(200);
    const body = await res.json() as any[];
    expect(Array.isArray(body)).toBe(true);
    const found = body.find((c: any) => c.id === courseId);
    expect(found).toBeDefined();
    expect(found.name).toBe('Intro to React');
  });

  // --- GET /:id (course details) ---

  it('GET /api/courses/:id requires auth', async () => {
    const res = await app.request(`/api/courses/${courseId}`);
    expect(res.status).toBe(401);
  });

  it('GET /api/courses/:id returns course details', async () => {
    const res = await app.request(`/api/courses/${courseId}`, { headers });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.id).toBe(courseId);
    expect(body.name).toBe('Intro to React');
    expect(body.concepts).toBeDefined();
    expect(Array.isArray(body.concepts)).toBe(true);
    expect(body.modules).toBeDefined();
    expect(Array.isArray(body.modules)).toBe(true);
  });

  it('GET /api/courses/:id returns 404 for nonexistent course', async () => {
    const res = await app.request('/api/courses/nonexistent-id', { headers });
    expect(res.status).toBe(404);
  });

  // --- POST /:id/concepts (add concept to course) ---

  it('POST /api/courses/:id/concepts requires auth', async () => {
    const res = await app.request(`/api/courses/${courseId}/concepts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conceptId: testConceptId }),
    });
    expect(res.status).toBe(401);
  });

  it('POST /api/courses/:id/concepts validates input', async () => {
    const res = await app.request(`/api/courses/${courseId}/concepts`, {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('POST /api/courses/:id/concepts returns 404 for nonexistent course', async () => {
    const res = await app.request('/api/courses/nonexistent-id/concepts', {
      method: 'POST',
      headers,
      body: JSON.stringify({ conceptId: testConceptId }),
    });
    expect(res.status).toBe(404);
  });

  it('POST /api/courses/:id/concepts returns 404 for nonexistent concept', async () => {
    const res = await app.request(`/api/courses/${courseId}/concepts`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ conceptId: 'nonexistent-concept-xyz' }),
    });
    expect(res.status).toBe(404);
  });

  it('POST /api/courses/:id/concepts adds a concept to the course', async () => {
    const res = await app.request(`/api/courses/${courseId}/concepts`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        conceptId: testConceptId,
        learningObjective: 'Understand React hooks lifecycle',
        requiredMasteryThreshold: 0.8,
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.id).toBeDefined();
    expect(body.conceptId).toBe(testConceptId);
    expect(body.courseId).toBe(courseId);
    expect(body.learningObjective).toBe('Understand React hooks lifecycle');
    expect(body.requiredMasteryThreshold).toBe(0.8);
  });

  it('GET /api/courses/:id includes added concept', async () => {
    const res = await app.request(`/api/courses/${courseId}`, { headers });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.concepts.length).toBeGreaterThan(0);
    const cc = body.concepts.find((c: any) => c.conceptId === testConceptId);
    expect(cc).toBeDefined();
    expect(cc.requiredMasteryThreshold).toBe(0.8);
  });

  // --- POST /:id/activate (activate course) ---

  it('POST /api/courses/:id/activate requires auth', async () => {
    const res = await app.request(`/api/courses/${courseId}/activate`, {
      method: 'POST',
    });
    expect(res.status).toBe(401);
  });

  it('POST /api/courses/:id/activate returns 404 for nonexistent course', async () => {
    const res = await app.request('/api/courses/nonexistent-id/activate', {
      method: 'POST',
      headers,
    });
    expect(res.status).toBe(404);
  });

  it('POST /api/courses/:id/activate sets status to active', async () => {
    const res = await app.request(`/api/courses/${courseId}/activate`, {
      method: 'POST',
      headers,
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.id).toBe(courseId);
    expect(body.status).toBe('active');
  });

  // --- POST /:id/enroll (enroll user) ---

  it('POST /api/courses/:id/enroll requires auth', async () => {
    const res = await app.request(`/api/courses/${courseId}/enroll`, {
      method: 'POST',
    });
    expect(res.status).toBe(401);
  });

  it('POST /api/courses/:id/enroll returns 404 for nonexistent course', async () => {
    const res = await app.request('/api/courses/nonexistent-id/enroll', {
      method: 'POST',
      headers,
    });
    expect(res.status).toBe(404);
  });

  it('POST /api/courses/:id/enroll enrolls the user', async () => {
    const res = await app.request(`/api/courses/${courseId}/enroll`, {
      method: 'POST',
      headers,
    });
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.id).toBeDefined();
    expect(body.courseId).toBe(courseId);
    expect(body.userId).toBeDefined();
  });

  it('POST /api/courses/:id/enroll rejects duplicate enrollment', async () => {
    const res = await app.request(`/api/courses/${courseId}/enroll`, {
      method: 'POST',
      headers,
    });
    expect(res.status).toBe(409);
    const body = await res.json() as any;
    expect(body.error).toContain('Already enrolled');
  });

  // --- GET /:id/progress/:userId (student progress) ---

  it('GET /api/courses/:id/progress/:userId requires auth', async () => {
    const res = await app.request(`/api/courses/${courseId}/progress/some-user-id`);
    expect(res.status).toBe(401);
  });

  it('GET /api/courses/:id/progress/:userId returns 404 for nonexistent course', async () => {
    const res = await app.request('/api/courses/nonexistent-id/progress/some-user-id', { headers });
    expect(res.status).toBe(404);
  });

  it('GET /api/courses/:id/progress/:userId returns progress data', async () => {
    // Use the authenticated user's ID — we need to get it first
    const meRes = await app.request('/api/me', { headers });
    const me = await meRes.json() as any;
    const userId = me.user.id;

    const res = await app.request(`/api/courses/${courseId}/progress/${userId}`, { headers });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.courseId).toBe(courseId);
    expect(body.userId).toBe(userId);
    expect(Array.isArray(body.concepts)).toBe(true);
    expect(body.concepts.length).toBeGreaterThan(0);

    // Each concept should have mastery, threshold, and met fields
    const conceptProgress = body.concepts[0];
    expect(typeof conceptProgress.conceptId).toBe('string');
    expect(typeof conceptProgress.mastery).toBe('number');
    expect(typeof conceptProgress.threshold).toBe('number');
    expect(typeof conceptProgress.met).toBe('boolean');

    // Completion ratio
    expect(typeof body.completionRatio).toBe('number');
    expect(body.completionRatio).toBeGreaterThanOrEqual(0);
    expect(body.completionRatio).toBeLessThanOrEqual(1);
  });

  // --- Cleanup: verify we can list and the course exists ---

  it('GET /api/courses still includes the test course after all operations', async () => {
    const res = await app.request('/api/courses', { headers });
    expect(res.status).toBe(200);
    const body = await res.json() as any[];
    const found = body.find((c: any) => c.id === courseId);
    expect(found).toBeDefined();
    expect(found.status).toBe('active');
  });
});
