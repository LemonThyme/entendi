import { Hono } from 'hono';
import type { Env } from '../index.js';

export const openapiRoutes = new Hono<Env>();

const spec = {
  openapi: '3.0.3',
  info: {
    title: 'Entendi API',
    version: '0.3.0',
    description: 'Comprehension accountability layer for AI-assisted work. Observes concepts, probes understanding, and maintains a Bayesian knowledge graph.',
    contact: { url: 'https://entendi.dev/contact' },
    license: { name: 'MIT' },
  },
  servers: [
    { url: 'https://entendi.dev', description: 'Production' },
    { url: 'http://localhost:3456', description: 'Local development' },
  ],
  paths: {
    '/health': {
      get: {
        summary: 'Health check',
        description: 'Returns API and database connectivity status.',
        operationId: 'healthCheck',
        tags: ['Public'],
        responses: {
          '200': {
            description: 'Healthy',
            content: { 'application/json': { schema: { type: 'object', properties: { status: { type: 'string', example: 'ok' }, db: { type: 'string', example: 'connected' } } } } },
          },
          '503': { description: 'Database unreachable' },
        },
      },
    },
    '/api/waitlist': {
      post: {
        summary: 'Join waitlist',
        operationId: 'joinWaitlist',
        tags: ['Public'],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['email'], properties: { email: { type: 'string', format: 'email' } } } } },
        },
        responses: {
          '200': { description: 'Signed up successfully' },
          '400': { description: 'Invalid email' },
          '409': { description: 'Already signed up' },
        },
      },
    },
    '/api/contact': {
      post: {
        summary: 'Submit contact form',
        operationId: 'submitContact',
        tags: ['Public'],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['name', 'email', 'message'], properties: { name: { type: 'string', maxLength: 200 }, email: { type: 'string', format: 'email' }, message: { type: 'string', maxLength: 5000 } } } } },
        },
        responses: {
          '200': { description: 'Message sent' },
          '400': { description: 'Validation error' },
        },
      },
    },
    '/privacy': {
      get: {
        summary: 'Privacy policy',
        operationId: 'privacyPolicy',
        tags: ['Public'],
        responses: { '200': { description: 'HTML privacy policy page', content: { 'text/html': {} } } },
      },
    },
    '/terms': {
      get: {
        summary: 'Terms of service',
        operationId: 'termsOfService',
        tags: ['Public'],
        responses: { '200': { description: 'HTML terms page', content: { 'text/html': {} } } },
      },
    },
    '/api/mcp/observe': {
      post: {
        summary: 'Observe concepts',
        description: 'Records that a user encountered one or more concepts. Returns probe candidates ranked by urgency, with optional probe tokens for evaluation.',
        operationId: 'mcpObserve',
        tags: ['MCP Proxy'],
        security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['concepts'],
                properties: {
                  concepts: {
                    type: 'array',
                    items: {
                      type: 'object',
                      required: ['id'],
                      properties: {
                        id: { type: 'string', description: 'Concept identifier (e.g. "typescript/generics")' },
                        domain: { type: 'string' },
                        depth: { type: 'number', minimum: 1, maximum: 3 },
                      },
                    },
                  },
                  sessionContext: { type: 'string', description: 'Optional session context for concept resolution' },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Observation recorded with probe candidates',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    probes: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          conceptId: { type: 'string' },
                          mastery: { type: 'number' },
                          urgency: { type: 'number' },
                          probeToken: { type: 'string' },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          '401': { description: 'Unauthorized' },
          '429': { description: 'Rate limit exceeded' },
        },
      },
    },
    '/api/mcp/record-evaluation': {
      post: {
        summary: 'Record evaluation',
        description: 'Records a probe evaluation result. Requires a valid probe token issued by observe. Updates mastery using Bayesian GRM model.',
        operationId: 'mcpRecordEvaluation',
        tags: ['MCP Proxy'],
        security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['conceptId', 'rubricScore'],
                properties: {
                  conceptId: { type: 'string' },
                  rubricScore: { type: 'integer', minimum: 0, maximum: 3, description: '0=no understanding, 1=partial, 2=solid, 3=mastery' },
                  responseText: { type: 'string', description: 'User response text for integrity analysis' },
                  probeToken: { type: 'string', description: 'HMAC-signed token from observe' },
                  depth: { type: 'number', minimum: 1, maximum: 3 },
                  criteria: { type: 'string' },
                  signals: { type: 'object' },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Evaluation recorded',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    updated: { type: 'boolean' },
                    mastery: { type: 'number' },
                    delta: { type: 'number' },
                  },
                },
              },
            },
          },
          '400': { description: 'Invalid probe token or parameters' },
          '401': { description: 'Unauthorized' },
          '429': { description: 'Per-concept rate limit exceeded (max 1 eval per concept per 24h)' },
        },
      },
    },
    '/api/mcp/tutor/start': {
      post: {
        summary: 'Start tutor session',
        description: 'Starts a 4-phase Socratic tutoring dialogue for a concept.',
        operationId: 'mcpTutorStart',
        tags: ['MCP Proxy'],
        security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['conceptId'],
                properties: {
                  conceptId: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Tutor session started',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    sessionId: { type: 'string' },
                    phase: { type: 'integer' },
                    prompt: { type: 'string' },
                  },
                },
              },
            },
          },
          '401': { description: 'Unauthorized' },
        },
      },
    },
    '/api/mcp/tutor/advance': {
      post: {
        summary: 'Advance tutor session',
        description: 'Submits a response to the current tutor phase and advances to the next phase.',
        operationId: 'mcpTutorAdvance',
        tags: ['MCP Proxy'],
        security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['sessionId', 'response'],
                properties: {
                  sessionId: { type: 'string' },
                  response: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Phase advanced',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    phase: { type: 'integer' },
                    prompt: { type: 'string' },
                    complete: { type: 'boolean' },
                  },
                },
              },
            },
          },
          '401': { description: 'Unauthorized' },
          '404': { description: 'Session not found' },
        },
      },
    },
    '/api/mcp/dismiss': {
      post: {
        summary: 'Dismiss a probe',
        description: 'Records that the user dismissed a probe. Tracks dismissal reason for audit.',
        operationId: 'mcpDismiss',
        tags: ['MCP Proxy'],
        security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['conceptId', 'reason'],
                properties: {
                  conceptId: { type: 'string' },
                  reason: { type: 'string', enum: ['topic_change', 'busy', 'claimed_expertise'] },
                  probeToken: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Dismissal recorded' },
          '401': { description: 'Unauthorized' },
        },
      },
    },
    '/api/mcp/status': {
      get: {
        summary: 'Get mastery status',
        description: 'Returns mastery status for a specific concept (via conceptId query param) or an overview of all concepts.',
        operationId: 'mcpStatus',
        tags: ['MCP Proxy'],
        security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
        parameters: [
          { name: 'conceptId', in: 'query', schema: { type: 'string' }, description: 'Optional concept ID for single-concept status' },
        ],
        responses: {
          '200': {
            description: 'Mastery status',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    concept: {
                      type: 'object',
                      properties: {
                        mastery: { type: 'number' },
                        sigma: { type: 'number' },
                        confidenceLevel: { type: 'string', enum: ['high', 'medium', 'low', 'none'] },
                        assessmentCount: { type: 'integer' },
                        urgency: { type: 'number' },
                      },
                    },
                    overview: {
                      type: 'object',
                      properties: {
                        totalConcepts: { type: 'integer' },
                        mastered: { type: 'integer' },
                        inProgress: { type: 'integer' },
                        unknown: { type: 'integer' },
                      },
                    },
                  },
                },
              },
            },
          },
          '401': { description: 'Unauthorized' },
        },
      },
    },
    '/api/mcp/zpd-frontier': {
      get: {
        summary: 'Get ZPD frontier',
        description: 'Returns concepts in the Zone of Proximal Development — concepts the user is ready to learn next, sorted by Fisher information.',
        operationId: 'mcpZpdFrontier',
        tags: ['MCP Proxy'],
        security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
        responses: {
          '200': {
            description: 'ZPD frontier concepts',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    frontier: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          conceptId: { type: 'string' },
                          mastery: { type: 'number' },
                          fisherInfo: { type: 'number' },
                        },
                      },
                    },
                    totalConcepts: { type: 'integer' },
                    masteredCount: { type: 'integer' },
                  },
                },
              },
            },
          },
          '401': { description: 'Unauthorized' },
        },
      },
    },
    '/api/auth/{path}': {
      get: {
        summary: 'Authentication routes',
        description: 'Better Auth handles all /api/auth/* routes including sign-in, sign-up, sign-out, session management, API keys, and organization management. See https://www.better-auth.com/docs for full documentation.',
        operationId: 'authRoutes',
        tags: ['Auth'],
        parameters: [{ name: 'path', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Varies by endpoint' } },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        description: 'Bearer token from sign-in response',
      },
      apiKeyAuth: {
        type: 'apiKey',
        in: 'header',
        name: 'x-api-key',
        description: 'API key created via dashboard or API',
      },
    },
  },
  tags: [
    { name: 'Public', description: 'Unauthenticated endpoints' },
    { name: 'MCP Proxy', description: 'Model Context Protocol proxy endpoints for concept observation, evaluation, tutoring, and status' },
    { name: 'Auth', description: 'Authentication via Better Auth (email/password, social, API keys)' },
  ],
};

openapiRoutes.get('/openapi.json', (c) => {
  return c.json(spec);
});
