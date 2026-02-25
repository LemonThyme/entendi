import type { ConceptSpecificity } from '../schemas/types.js';

export interface PackageConceptMapping {
  name: string;
  specificity: ConceptSpecificity;
  domain: string;
  confidence: number;
}

/**
 * Lookup table mapping common packages to the concepts they imply.
 * Each package maps to one or more concepts with a specificity level,
 * domain classification, and confidence score.
 */
export const PACKAGE_CONCEPT_MAP: Record<string, PackageConceptMapping[]> = {
  // --- Databases & Data Stores ---
  redis: [
    { name: 'Redis', specificity: 'topic', domain: 'databases', confidence: 0.9 },
    { name: 'Caching', specificity: 'technique', domain: 'databases', confidence: 0.8 },
    { name: 'In-Memory Data Store', specificity: 'topic', domain: 'databases', confidence: 0.7 },
  ],
  bullmq: [
    { name: 'Message Queues', specificity: 'topic', domain: 'distributed-systems', confidence: 0.9 },
    { name: 'Job Scheduling', specificity: 'technique', domain: 'distributed-systems', confidence: 0.8 },
    { name: 'Redis', specificity: 'topic', domain: 'databases', confidence: 0.6 },
  ],
  prisma: [
    { name: 'ORM', specificity: 'technique', domain: 'databases', confidence: 0.9 },
    { name: 'Database Schema Design', specificity: 'topic', domain: 'databases', confidence: 0.7 },
    { name: 'SQL', specificity: 'topic', domain: 'databases', confidence: 0.6 },
  ],
  mongoose: [
    { name: 'MongoDB', specificity: 'topic', domain: 'databases', confidence: 0.9 },
    { name: 'ODM', specificity: 'technique', domain: 'databases', confidence: 0.8 },
    { name: 'NoSQL', specificity: 'topic', domain: 'databases', confidence: 0.7 },
  ],
  pg: [
    { name: 'PostgreSQL', specificity: 'topic', domain: 'databases', confidence: 0.9 },
    { name: 'SQL', specificity: 'topic', domain: 'databases', confidence: 0.8 },
    { name: 'Relational Databases', specificity: 'topic', domain: 'databases', confidence: 0.7 },
  ],

  // --- Web Frameworks ---
  express: [
    { name: 'Express.js', specificity: 'topic', domain: 'web-development', confidence: 0.9 },
    { name: 'HTTP Server', specificity: 'topic', domain: 'web-development', confidence: 0.7 },
    { name: 'REST API', specificity: 'technique', domain: 'web-development', confidence: 0.6 },
  ],
  fastify: [
    { name: 'Fastify', specificity: 'topic', domain: 'web-development', confidence: 0.9 },
    { name: 'HTTP Server', specificity: 'topic', domain: 'web-development', confidence: 0.7 },
    { name: 'REST API', specificity: 'technique', domain: 'web-development', confidence: 0.6 },
  ],
  flask: [
    { name: 'Flask', specificity: 'topic', domain: 'web-development', confidence: 0.9 },
    { name: 'HTTP Server', specificity: 'topic', domain: 'web-development', confidence: 0.7 },
    { name: 'Python Web Development', specificity: 'topic', domain: 'web-development', confidence: 0.6 },
  ],
  django: [
    { name: 'Django', specificity: 'topic', domain: 'web-development', confidence: 0.9 },
    { name: 'MVC Architecture', specificity: 'technique', domain: 'web-development', confidence: 0.7 },
    { name: 'Python Web Development', specificity: 'topic', domain: 'web-development', confidence: 0.6 },
    { name: 'ORM', specificity: 'technique', domain: 'databases', confidence: 0.5 },
  ],

  // --- Frontend Frameworks ---
  react: [
    { name: 'React', specificity: 'topic', domain: 'frontend', confidence: 0.9 },
    { name: 'Component-Based UI', specificity: 'technique', domain: 'frontend', confidence: 0.7 },
    { name: 'Frontend Development', specificity: 'domain', domain: 'frontend', confidence: 0.6 },
  ],
  vue: [
    { name: 'Vue.js', specificity: 'topic', domain: 'frontend', confidence: 0.9 },
    { name: 'Component-Based UI', specificity: 'technique', domain: 'frontend', confidence: 0.7 },
    { name: 'Frontend Development', specificity: 'domain', domain: 'frontend', confidence: 0.6 },
  ],
  next: [
    { name: 'Next.js', specificity: 'topic', domain: 'frontend', confidence: 0.9 },
    { name: 'Server-Side Rendering', specificity: 'technique', domain: 'frontend', confidence: 0.7 },
    { name: 'React', specificity: 'topic', domain: 'frontend', confidence: 0.6 },
  ],

  // --- Validation ---
  zod: [
    { name: 'Schema Validation', specificity: 'technique', domain: 'data-validation', confidence: 0.9 },
    { name: 'Type-Safe Validation', specificity: 'technique', domain: 'data-validation', confidence: 0.7 },
  ],
  joi: [
    { name: 'Schema Validation', specificity: 'technique', domain: 'data-validation', confidence: 0.9 },
    { name: 'Input Validation', specificity: 'technique', domain: 'data-validation', confidence: 0.7 },
  ],

  // --- Auth & Security ---
  passport: [
    { name: 'Authentication', specificity: 'topic', domain: 'security', confidence: 0.9 },
    { name: 'OAuth', specificity: 'technique', domain: 'security', confidence: 0.6 },
  ],
  jsonwebtoken: [
    { name: 'JWT', specificity: 'technique', domain: 'security', confidence: 0.9 },
    { name: 'Authentication', specificity: 'topic', domain: 'security', confidence: 0.8 },
    { name: 'Token-Based Auth', specificity: 'technique', domain: 'security', confidence: 0.7 },
  ],
  bcrypt: [
    { name: 'Password Hashing', specificity: 'technique', domain: 'security', confidence: 0.9 },
    { name: 'Authentication', specificity: 'topic', domain: 'security', confidence: 0.7 },
    { name: 'Cryptography', specificity: 'topic', domain: 'security', confidence: 0.5 },
  ],

  // --- Testing ---
  vitest: [
    { name: 'Unit Testing', specificity: 'technique', domain: 'testing', confidence: 0.9 },
    { name: 'Test-Driven Development', specificity: 'technique', domain: 'testing', confidence: 0.6 },
  ],
  jest: [
    { name: 'Unit Testing', specificity: 'technique', domain: 'testing', confidence: 0.9 },
    { name: 'Test-Driven Development', specificity: 'technique', domain: 'testing', confidence: 0.6 },
  ],

  // --- Python ML / Data Science ---
  numpy: [
    { name: 'NumPy', specificity: 'topic', domain: 'data-science', confidence: 0.9 },
    { name: 'Numerical Computing', specificity: 'topic', domain: 'data-science', confidence: 0.8 },
    { name: 'Array Operations', specificity: 'technique', domain: 'data-science', confidence: 0.6 },
  ],
  pandas: [
    { name: 'Pandas', specificity: 'topic', domain: 'data-science', confidence: 0.9 },
    { name: 'Data Manipulation', specificity: 'technique', domain: 'data-science', confidence: 0.8 },
    { name: 'Tabular Data', specificity: 'topic', domain: 'data-science', confidence: 0.6 },
  ],
  pytorch: [
    { name: 'PyTorch', specificity: 'topic', domain: 'data-science', confidence: 0.9 },
    { name: 'Deep Learning', specificity: 'topic', domain: 'data-science', confidence: 0.8 },
    { name: 'Neural Networks', specificity: 'technique', domain: 'data-science', confidence: 0.7 },
  ],
  torch: [
    { name: 'PyTorch', specificity: 'topic', domain: 'data-science', confidence: 0.9 },
    { name: 'Deep Learning', specificity: 'topic', domain: 'data-science', confidence: 0.8 },
    { name: 'Neural Networks', specificity: 'technique', domain: 'data-science', confidence: 0.7 },
  ],
  tensorflow: [
    { name: 'TensorFlow', specificity: 'topic', domain: 'data-science', confidence: 0.9 },
    { name: 'Deep Learning', specificity: 'topic', domain: 'data-science', confidence: 0.8 },
    { name: 'Neural Networks', specificity: 'technique', domain: 'data-science', confidence: 0.7 },
  ],
  pymc: [
    { name: 'PyMC', specificity: 'topic', domain: 'data-science', confidence: 0.9 },
    { name: 'Bayesian Statistics', specificity: 'technique', domain: 'data-science', confidence: 0.8 },
    { name: 'Probabilistic Programming', specificity: 'technique', domain: 'data-science', confidence: 0.7 },
  ],

  // --- Utilities ---
  axios: [
    { name: 'HTTP Client', specificity: 'technique', domain: 'web-development', confidence: 0.9 },
    { name: 'API Integration', specificity: 'technique', domain: 'web-development', confidence: 0.6 },
  ],
  lodash: [
    { name: 'Utility Functions', specificity: 'technique', domain: 'general', confidence: 0.7 },
    { name: 'Functional Programming', specificity: 'technique', domain: 'general', confidence: 0.5 },
  ],

  // --- AI / LLM SDKs ---
  '@anthropic-ai/sdk': [
    { name: 'Claude API', specificity: 'topic', domain: 'ai', confidence: 0.9 },
    { name: 'LLM Integration', specificity: 'technique', domain: 'ai', confidence: 0.8 },
    { name: 'AI-Assisted Development', specificity: 'topic', domain: 'ai', confidence: 0.6 },
  ],
  openai: [
    { name: 'OpenAI API', specificity: 'topic', domain: 'ai', confidence: 0.9 },
    { name: 'LLM Integration', specificity: 'technique', domain: 'ai', confidence: 0.8 },
    { name: 'AI-Assisted Development', specificity: 'topic', domain: 'ai', confidence: 0.6 },
  ],
  langchain: [
    { name: 'LangChain', specificity: 'topic', domain: 'ai', confidence: 0.9 },
    { name: 'LLM Orchestration', specificity: 'technique', domain: 'ai', confidence: 0.8 },
    { name: 'RAG', specificity: 'technique', domain: 'ai', confidence: 0.6 },
    { name: 'AI-Assisted Development', specificity: 'topic', domain: 'ai', confidence: 0.5 },
  ],

  // --- Additional common packages ---
  'socket.io': [
    { name: 'WebSockets', specificity: 'technique', domain: 'web-development', confidence: 0.9 },
    { name: 'Real-Time Communication', specificity: 'topic', domain: 'web-development', confidence: 0.8 },
  ],
  graphql: [
    { name: 'GraphQL', specificity: 'topic', domain: 'web-development', confidence: 0.9 },
    { name: 'API Design', specificity: 'technique', domain: 'web-development', confidence: 0.7 },
  ],
  docker: [
    { name: 'Docker', specificity: 'topic', domain: 'devops', confidence: 0.9 },
    { name: 'Containerization', specificity: 'technique', domain: 'devops', confidence: 0.8 },
  ],
  webpack: [
    { name: 'Webpack', specificity: 'topic', domain: 'frontend', confidence: 0.9 },
    { name: 'Module Bundling', specificity: 'technique', domain: 'frontend', confidence: 0.8 },
  ],
  tailwindcss: [
    { name: 'Tailwind CSS', specificity: 'topic', domain: 'frontend', confidence: 0.9 },
    { name: 'CSS Utility Framework', specificity: 'technique', domain: 'frontend', confidence: 0.7 },
  ],
  'drizzle-orm': [
    { name: 'Drizzle ORM', specificity: 'topic', domain: 'databases', confidence: 0.9 },
    { name: 'ORM', specificity: 'technique', domain: 'databases', confidence: 0.8 },
    { name: 'SQL', specificity: 'topic', domain: 'databases', confidence: 0.6 },
  ],
  trpc: [
    { name: 'tRPC', specificity: 'topic', domain: 'web-development', confidence: 0.9 },
    { name: 'Type-Safe API', specificity: 'technique', domain: 'web-development', confidence: 0.8 },
    { name: 'RPC', specificity: 'technique', domain: 'web-development', confidence: 0.6 },
  ],
};
