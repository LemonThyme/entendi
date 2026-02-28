import { describe, expect, it } from 'vitest';

describe('OpenAPI spec (unit)', () => {
  it('spec object has correct structure', async () => {
    const { openapiRoutes } = await import('../../../src/api/routes/openapi.js');
    expect(openapiRoutes).toBeDefined();

    // Exercise the route handler directly via Hono test helper
    const res = await openapiRoutes.request('/openapi.json');
    expect(res.status).toBe(200);

    const spec = await res.json() as any;
    expect(spec.openapi).toBe('3.0.3');
    expect(spec.info.title).toBe('Entendi API');
    expect(spec.info.version).toBe('0.3.0');
  });

  it('spec includes MCP proxy paths', async () => {
    const { openapiRoutes } = await import('../../../src/api/routes/openapi.js');
    const res = await openapiRoutes.request('/openapi.json');
    const spec = await res.json() as any;

    expect(spec.paths['/api/mcp/observe']).toBeDefined();
    expect(spec.paths['/api/mcp/record-evaluation']).toBeDefined();
    expect(spec.paths['/api/mcp/tutor/start']).toBeDefined();
    expect(spec.paths['/api/mcp/tutor/advance']).toBeDefined();
    expect(spec.paths['/api/mcp/dismiss']).toBeDefined();
    expect(spec.paths['/api/mcp/status']).toBeDefined();
    expect(spec.paths['/api/mcp/zpd-frontier']).toBeDefined();
  });

  it('spec includes public paths', async () => {
    const { openapiRoutes } = await import('../../../src/api/routes/openapi.js');
    const res = await openapiRoutes.request('/openapi.json');
    const spec = await res.json() as any;

    expect(spec.paths['/health']).toBeDefined();
    expect(spec.paths['/api/waitlist']).toBeDefined();
    expect(spec.paths['/api/contact']).toBeDefined();
    expect(spec.paths['/privacy']).toBeDefined();
    expect(spec.paths['/terms']).toBeDefined();
  });

  it('spec includes security schemes', async () => {
    const { openapiRoutes } = await import('../../../src/api/routes/openapi.js');
    const res = await openapiRoutes.request('/openapi.json');
    const spec = await res.json() as any;

    expect(spec.components.securitySchemes.bearerAuth).toBeDefined();
    expect(spec.components.securitySchemes.bearerAuth.type).toBe('http');
    expect(spec.components.securitySchemes.apiKeyAuth).toBeDefined();
    expect(spec.components.securitySchemes.apiKeyAuth.name).toBe('x-api-key');
  });

  it('spec includes tags', async () => {
    const { openapiRoutes } = await import('../../../src/api/routes/openapi.js');
    const res = await openapiRoutes.request('/openapi.json');
    const spec = await res.json() as any;

    const tagNames = spec.tags.map((t: any) => t.name);
    expect(tagNames).toContain('Public');
    expect(tagNames).toContain('MCP Proxy');
    expect(tagNames).toContain('Auth');
  });

  it('MCP endpoints require authentication', async () => {
    const { openapiRoutes } = await import('../../../src/api/routes/openapi.js');
    const res = await openapiRoutes.request('/openapi.json');
    const spec = await res.json() as any;

    const observe = spec.paths['/api/mcp/observe'].post;
    expect(observe.security).toBeDefined();
    expect(observe.security.length).toBeGreaterThan(0);
  });

  it('observe endpoint documents request/response schemas', async () => {
    const { openapiRoutes } = await import('../../../src/api/routes/openapi.js');
    const res = await openapiRoutes.request('/openapi.json');
    const spec = await res.json() as any;

    const observe = spec.paths['/api/mcp/observe'].post;
    expect(observe.requestBody.content['application/json'].schema.properties.concepts).toBeDefined();
    expect(observe.responses['200']).toBeDefined();
    expect(observe.responses['401']).toBeDefined();
  });
});
