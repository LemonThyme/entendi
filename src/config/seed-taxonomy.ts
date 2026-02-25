/**
 * Seed Concept Taxonomy for Entendi Knowledge Graph
 *
 * Design rationale:
 * ─────────────────
 * This taxonomy draws structural inspiration from two authoritative sources:
 *
 * 1. SWEBOK v4 (IEEE Software Engineering Body of Knowledge, 2024)
 *    18 Knowledge Areas including Software Requirements, Software Architecture,
 *    Software Design, Software Construction, Software Testing, Software Security,
 *    Software Engineering Operations, Computing Foundations, etc.
 *    We map development-relevant KAs to our domain structure.
 *
 * 2. ACM CCS 2012 (Computing Classification System)
 *    13 top-level categories including "Software and its engineering" (with 192
 *    descendant terms across Software creation/management, Software notations/tools,
 *    Software organization/properties), "Security and privacy", "Information systems",
 *    "Computing methodologies", "Theory of computation", "Networks", etc.
 *
 * Practical constraints:
 *   - ~120 seed concepts (lean start, discoverable concepts expand over time)
 *   - Three specificity tiers: domain > topic > technique
 *   - Prerequisites form a DAG (directed acyclic graph)
 *   - Concepts should be things a developer actually encounters with AI coding tools
 *   - Domain names align with existing package-concepts.ts usage
 *
 * Taxonomy structure:
 *   Domain (specificity: 'domain')  ~10 domains
 *     └─ Topic (specificity: 'topic')  ~50 topics
 *         └─ Technique (specificity: 'technique')  ~60 techniques
 */

import type { ConceptNode, ConceptEdge, ConceptSpecificity, EdgeType } from '../schemas/types.js';
import { DEFAULT_GRM_PARAMS } from '../schemas/types.js';

// ── Shorthand builder ──────────────────────────────────────────────────────

interface SeedConcept {
  conceptId: string;
  aliases: string[];
  domain: string;
  specificity: ConceptSpecificity;
  parentConcept: string | null;
  relationships: ConceptEdge[];
}

function edge(target: string, type: EdgeType): ConceptEdge {
  return { target, type };
}

function seed(
  conceptId: string,
  domain: string,
  specificity: ConceptSpecificity,
  parentConcept: string | null,
  aliases: string[],
  relationships: ConceptEdge[],
): SeedConcept {
  return { conceptId, aliases, domain, specificity, parentConcept, relationships };
}

// ── Domain definitions ─────────────────────────────────────────────────────
// These map to SWEBOK v4 KAs and ACM CCS top-level categories:
//
//   programming-languages   → SWEBOK: Software Construction / Computing Foundations
//                             ACM CCS: Software notations and tools
//   data-structures-algos   → SWEBOK: Computing Foundations
//                             ACM CCS: Theory of computation > Design and analysis of algorithms
//   web-development         → SWEBOK: Software Construction / Software Architecture
//                             ACM CCS: Information systems > World Wide Web
//   frontend                → ACM CCS: Human-centered computing > Interaction design
//   databases               → SWEBOK: Computing Foundations (databases)
//                             ACM CCS: Information systems > Data management systems
//   devops                  → SWEBOK: Software Engineering Operations (new in v4)
//                             ACM CCS: Software creation and management
//   security                → SWEBOK: Software Security (new in v4)
//                             ACM CCS: Security and privacy
//   testing                 → SWEBOK: Software Testing
//                             ACM CCS: Software verification and validation
//   system-design           → SWEBOK: Software Architecture (new in v4) / Software Design
//                             ACM CCS: Software system structures
//   ai-ml                   → SWEBOK: Computing Foundations (AI/ML, new in v4)
//                             ACM CCS: Computing methodologies > AI / ML

export const SEED_CONCEPTS: SeedConcept[] = [

  // ════════════════════════════════════════════════════════════════════════
  // DOMAIN: programming-languages
  // SWEBOK v4: Software Construction (Ch 4), Computing Foundations (Ch 16)
  // ACM CCS: Software notations and tools > General programming languages
  // ════════════════════════════════════════════════════════════════════════

  seed('programming-languages', 'programming-languages', 'domain', null,
    ['Programming Languages', 'PLs', 'Languages'],
    []),

  // ── Topics ──
  seed('type-systems', 'programming-languages', 'topic', 'programming-languages',
    ['Type Systems', 'Typing', 'Type Theory'],
    [edge('programming-languages', 'part_of')]),

  seed('object-oriented-programming', 'programming-languages', 'topic', 'programming-languages',
    ['OOP', 'Object-Oriented', 'Object Oriented Programming'],
    [edge('programming-languages', 'part_of')]),

  seed('functional-programming', 'programming-languages', 'topic', 'programming-languages',
    ['FP', 'Functional', 'Functional Programming'],
    [edge('programming-languages', 'part_of')]),

  seed('async-programming', 'programming-languages', 'topic', 'programming-languages',
    ['Asynchronous Programming', 'Async/Await', 'Concurrency'],
    [edge('programming-languages', 'part_of')]),

  seed('error-handling', 'programming-languages', 'topic', 'programming-languages',
    ['Error Handling', 'Exception Handling', 'Errors'],
    [edge('programming-languages', 'part_of')]),

  seed('memory-management', 'programming-languages', 'topic', 'programming-languages',
    ['Memory Management', 'Garbage Collection', 'Memory'],
    [edge('programming-languages', 'part_of')]),

  // ── Techniques ──
  seed('generics', 'programming-languages', 'technique', 'type-systems',
    ['Generics', 'Generic Types', 'Parametric Polymorphism', 'Type Parameters'],
    [edge('type-systems', 'part_of'), edge('type-systems', 'requires')]),

  seed('type-narrowing', 'programming-languages', 'technique', 'type-systems',
    ['Type Narrowing', 'Type Guards', 'Discriminated Unions'],
    [edge('type-systems', 'part_of'), edge('type-systems', 'requires')]),

  seed('interfaces-and-protocols', 'programming-languages', 'technique', 'type-systems',
    ['Interfaces', 'Protocols', 'Abstract Types', 'Traits'],
    [edge('type-systems', 'part_of'), edge('object-oriented-programming', 'related_to')]),

  seed('inheritance', 'programming-languages', 'technique', 'object-oriented-programming',
    ['Inheritance', 'Class Inheritance', 'Subclassing'],
    [edge('object-oriented-programming', 'part_of'), edge('object-oriented-programming', 'requires')]),

  seed('composition-over-inheritance', 'programming-languages', 'technique', 'object-oriented-programming',
    ['Composition', 'Composition Over Inheritance', 'Has-A vs Is-A'],
    [edge('object-oriented-programming', 'requires'), edge('inheritance', 'alternative_to')]),

  seed('closures', 'programming-languages', 'technique', 'functional-programming',
    ['Closures', 'Lexical Closures', 'Closure'],
    [edge('functional-programming', 'part_of'), edge('functional-programming', 'requires')]),

  seed('higher-order-functions', 'programming-languages', 'technique', 'functional-programming',
    ['Higher-Order Functions', 'HOF', 'Map/Filter/Reduce'],
    [edge('functional-programming', 'part_of'), edge('closures', 'related_to')]),

  seed('immutability', 'programming-languages', 'technique', 'functional-programming',
    ['Immutability', 'Immutable Data', 'Readonly'],
    [edge('functional-programming', 'part_of')]),

  seed('promises-and-futures', 'programming-languages', 'technique', 'async-programming',
    ['Promises', 'Futures', 'Promise', 'Async/Await'],
    [edge('async-programming', 'part_of'), edge('async-programming', 'requires')]),

  seed('event-loop', 'programming-languages', 'technique', 'async-programming',
    ['Event Loop', 'Event-Driven', 'Non-Blocking I/O'],
    [edge('async-programming', 'part_of')]),

  seed('iterators-generators', 'programming-languages', 'technique', 'programming-languages',
    ['Iterators', 'Generators', 'Yield', 'Iterator Protocol'],
    [edge('programming-languages', 'part_of'), edge('closures', 'related_to')]),

  seed('decorators-metaprogramming', 'programming-languages', 'technique', 'programming-languages',
    ['Decorators', 'Metaprogramming', 'Annotations', 'Reflection'],
    [edge('programming-languages', 'part_of'), edge('higher-order-functions', 'related_to')]),

  // ════════════════════════════════════════════════════════════════════════
  // DOMAIN: data-structures-algos
  // SWEBOK v4: Computing Foundations (Ch 16)
  // ACM CCS: Theory of computation > Design and analysis of algorithms
  // ════════════════════════════════════════════════════════════════════════

  seed('data-structures-algorithms', 'data-structures-algos', 'domain', null,
    ['Data Structures & Algorithms', 'DSA', 'Algorithms'],
    []),

  // ── Topics ──
  seed('complexity-analysis', 'data-structures-algos', 'topic', 'data-structures-algorithms',
    ['Big O', 'Complexity Analysis', 'Time Complexity', 'Space Complexity', 'Asymptotic Analysis'],
    [edge('data-structures-algorithms', 'part_of')]),

  seed('linear-data-structures', 'data-structures-algos', 'topic', 'data-structures-algorithms',
    ['Linear Data Structures', 'Arrays', 'Linked Lists', 'Stacks', 'Queues'],
    [edge('data-structures-algorithms', 'part_of')]),

  seed('tree-data-structures', 'data-structures-algos', 'topic', 'data-structures-algorithms',
    ['Trees', 'Binary Trees', 'BST', 'Tree Data Structures'],
    [edge('data-structures-algorithms', 'part_of'), edge('linear-data-structures', 'requires')]),

  seed('hash-based-structures', 'data-structures-algos', 'topic', 'data-structures-algorithms',
    ['Hash Tables', 'Hash Maps', 'Sets', 'Hash-Based Structures'],
    [edge('data-structures-algorithms', 'part_of')]),

  seed('graph-data-structures', 'data-structures-algos', 'topic', 'data-structures-algorithms',
    ['Graphs', 'Graph Data Structures', 'Adjacency List', 'Adjacency Matrix'],
    [edge('data-structures-algorithms', 'part_of'), edge('tree-data-structures', 'requires')]),

  seed('sorting-algorithms', 'data-structures-algos', 'topic', 'data-structures-algorithms',
    ['Sorting', 'Sort Algorithms', 'Sorting Algorithms'],
    [edge('data-structures-algorithms', 'part_of'), edge('complexity-analysis', 'requires')]),

  // ── Techniques ──
  seed('recursion', 'data-structures-algos', 'technique', 'data-structures-algorithms',
    ['Recursion', 'Recursive Algorithms', 'Base Case'],
    [edge('data-structures-algorithms', 'part_of')]),

  seed('dynamic-programming', 'data-structures-algos', 'technique', 'data-structures-algorithms',
    ['Dynamic Programming', 'DP', 'Memoization'],
    [edge('recursion', 'requires'), edge('complexity-analysis', 'requires')]),

  seed('graph-traversal', 'data-structures-algos', 'technique', 'graph-data-structures',
    ['BFS', 'DFS', 'Graph Traversal', 'Breadth-First Search', 'Depth-First Search'],
    [edge('graph-data-structures', 'requires'), edge('recursion', 'related_to')]),

  seed('binary-search', 'data-structures-algos', 'technique', 'data-structures-algorithms',
    ['Binary Search', 'Divide and Conquer'],
    [edge('sorting-algorithms', 'related_to'), edge('complexity-analysis', 'requires')]),

  // ════════════════════════════════════════════════════════════════════════
  // DOMAIN: web-development (backend-focused)
  // SWEBOK v4: Software Construction (Ch 4), Software Architecture (Ch 2)
  // ACM CCS: Information systems > World Wide Web; Software > Context specific languages
  // ════════════════════════════════════════════════════════════════════════

  seed('web-development', 'web-development', 'domain', null,
    ['Web Development', 'Web Dev', 'Backend Development'],
    []),

  // ── Topics ──
  seed('http-protocol', 'web-development', 'topic', 'web-development',
    ['HTTP', 'HTTP Protocol', 'HTTP/2', 'HTTPS', 'Request/Response'],
    [edge('web-development', 'part_of')]),

  seed('rest-api-design', 'web-development', 'topic', 'web-development',
    ['REST API', 'RESTful API', 'REST', 'API Design'],
    [edge('web-development', 'part_of'), edge('http-protocol', 'requires')]),

  seed('graphql-api', 'web-development', 'topic', 'web-development',
    ['GraphQL', 'GraphQL API', 'Schema-First API'],
    [edge('web-development', 'part_of'), edge('http-protocol', 'requires'),
     edge('rest-api-design', 'alternative_to')]),

  seed('authentication-authorization', 'web-development', 'topic', 'web-development',
    ['Auth', 'Authentication', 'Authorization', 'AuthN/AuthZ'],
    [edge('web-development', 'part_of'), edge('http-protocol', 'requires')]),

  seed('middleware-pattern', 'web-development', 'topic', 'web-development',
    ['Middleware', 'Middleware Pattern', 'Request Pipeline'],
    [edge('web-development', 'part_of'), edge('http-protocol', 'requires')]),

  seed('websockets', 'web-development', 'topic', 'web-development',
    ['WebSockets', 'Real-Time Communication', 'Socket.IO', 'WS'],
    [edge('web-development', 'part_of'), edge('http-protocol', 'requires'),
     edge('event-loop', 'related_to')]),

  seed('server-side-rendering', 'web-development', 'topic', 'web-development',
    ['SSR', 'Server-Side Rendering', 'Server Rendering'],
    [edge('web-development', 'part_of'), edge('http-protocol', 'requires')]),

  // ── Techniques ──
  seed('jwt-tokens', 'web-development', 'technique', 'authentication-authorization',
    ['JWT', 'JSON Web Token', 'Bearer Token'],
    [edge('authentication-authorization', 'part_of'), edge('authentication-authorization', 'requires')]),

  seed('oauth-flow', 'web-development', 'technique', 'authentication-authorization',
    ['OAuth', 'OAuth 2.0', 'OpenID Connect', 'OIDC'],
    [edge('authentication-authorization', 'part_of'), edge('jwt-tokens', 'related_to')]),

  seed('rate-limiting', 'web-development', 'technique', 'web-development',
    ['Rate Limiting', 'Throttling', 'API Rate Limits'],
    [edge('middleware-pattern', 'related_to'), edge('http-protocol', 'requires')]),

  seed('cors', 'web-development', 'technique', 'web-development',
    ['CORS', 'Cross-Origin Resource Sharing', 'Same-Origin Policy'],
    [edge('http-protocol', 'requires'), edge('middleware-pattern', 'related_to')]),

  seed('request-validation', 'web-development', 'technique', 'web-development',
    ['Request Validation', 'Input Validation', 'Schema Validation'],
    [edge('rest-api-design', 'related_to'), edge('middleware-pattern', 'related_to')]),

  seed('caching-strategies', 'web-development', 'technique', 'web-development',
    ['Caching', 'HTTP Caching', 'Cache Invalidation', 'CDN Caching'],
    [edge('http-protocol', 'requires')]),

  seed('pagination', 'web-development', 'technique', 'rest-api-design',
    ['Pagination', 'Cursor Pagination', 'Offset Pagination'],
    [edge('rest-api-design', 'part_of')]),

  // ════════════════════════════════════════════════════════════════════════
  // DOMAIN: frontend
  // ACM CCS: Human-centered computing > Interaction design
  // ════════════════════════════════════════════════════════════════════════

  seed('frontend-development', 'frontend', 'domain', null,
    ['Frontend Development', 'Frontend', 'Client-Side Development', 'UI Development'],
    []),

  // ── Topics ──
  seed('dom-manipulation', 'frontend', 'topic', 'frontend-development',
    ['DOM', 'DOM Manipulation', 'Document Object Model'],
    [edge('frontend-development', 'part_of')]),

  seed('component-architecture', 'frontend', 'topic', 'frontend-development',
    ['Component Architecture', 'Component-Based UI', 'UI Components'],
    [edge('frontend-development', 'part_of'), edge('dom-manipulation', 'requires')]),

  seed('state-management', 'frontend', 'topic', 'frontend-development',
    ['State Management', 'Application State', 'Global State'],
    [edge('frontend-development', 'part_of'), edge('component-architecture', 'requires')]),

  seed('css-layout', 'frontend', 'topic', 'frontend-development',
    ['CSS Layout', 'Flexbox', 'CSS Grid', 'Responsive Design'],
    [edge('frontend-development', 'part_of')]),

  seed('client-side-routing', 'frontend', 'topic', 'frontend-development',
    ['Client-Side Routing', 'SPA Routing', 'Router'],
    [edge('frontend-development', 'part_of'), edge('component-architecture', 'requires')]),

  seed('build-tools', 'frontend', 'topic', 'frontend-development',
    ['Build Tools', 'Bundlers', 'Module Bundling', 'Webpack', 'Vite', 'esbuild'],
    [edge('frontend-development', 'part_of')]),

  // ── Techniques ──
  seed('virtual-dom', 'frontend', 'technique', 'component-architecture',
    ['Virtual DOM', 'VDOM', 'Reconciliation'],
    [edge('component-architecture', 'part_of'), edge('dom-manipulation', 'requires')]),

  seed('react-hooks', 'frontend', 'technique', 'component-architecture',
    ['React Hooks', 'useState', 'useEffect', 'Custom Hooks'],
    [edge('component-architecture', 'part_of'), edge('closures', 'requires'),
     edge('state-management', 'related_to')]),

  seed('reactive-data-binding', 'frontend', 'technique', 'component-architecture',
    ['Reactive Binding', 'Two-Way Binding', 'Reactivity', 'Signals'],
    [edge('component-architecture', 'part_of'), edge('state-management', 'related_to')]),

  seed('css-in-js', 'frontend', 'technique', 'css-layout',
    ['CSS-in-JS', 'Styled Components', 'Tailwind', 'CSS Modules'],
    [edge('css-layout', 'part_of')]),

  seed('accessibility', 'frontend', 'technique', 'frontend-development',
    ['Accessibility', 'a11y', 'ARIA', 'Screen Readers', 'WCAG'],
    [edge('frontend-development', 'part_of'), edge('dom-manipulation', 'related_to')]),

  // ════════════════════════════════════════════════════════════════════════
  // DOMAIN: databases
  // SWEBOK v4: Computing Foundations (databases topic)
  // ACM CCS: Information systems > Data management systems
  // ════════════════════════════════════════════════════════════════════════

  seed('databases', 'databases', 'domain', null,
    ['Databases', 'Data Storage', 'Data Persistence'],
    []),

  // ── Topics ──
  seed('relational-databases', 'databases', 'topic', 'databases',
    ['Relational Databases', 'RDBMS', 'SQL Databases'],
    [edge('databases', 'part_of')]),

  seed('sql', 'databases', 'topic', 'databases',
    ['SQL', 'Structured Query Language', 'SQL Queries'],
    [edge('databases', 'part_of'), edge('relational-databases', 'related_to')]),

  seed('nosql-databases', 'databases', 'topic', 'databases',
    ['NoSQL', 'NoSQL Databases', 'Document Databases', 'MongoDB'],
    [edge('databases', 'part_of'), edge('relational-databases', 'alternative_to')]),

  seed('data-modeling', 'databases', 'topic', 'databases',
    ['Data Modeling', 'Schema Design', 'Entity Relationships', 'ER Diagrams'],
    [edge('databases', 'part_of')]),

  seed('database-indexing', 'databases', 'topic', 'databases',
    ['Database Indexes', 'Indexing', 'B-Tree Index', 'Query Optimization'],
    [edge('databases', 'part_of'), edge('sql', 'requires')]),

  seed('transactions-acid', 'databases', 'topic', 'databases',
    ['Transactions', 'ACID', 'Atomicity', 'Isolation Levels'],
    [edge('databases', 'part_of'), edge('relational-databases', 'requires')]),

  // ── Techniques ──
  seed('orm-usage', 'databases', 'technique', 'databases',
    ['ORM', 'Object-Relational Mapping', 'Prisma', 'Drizzle', 'SQLAlchemy', 'TypeORM'],
    [edge('sql', 'requires'), edge('data-modeling', 'related_to')]),

  seed('database-migrations', 'databases', 'technique', 'databases',
    ['Database Migrations', 'Schema Migrations', 'Migration Scripts'],
    [edge('data-modeling', 'requires'), edge('orm-usage', 'related_to')]),

  seed('query-optimization', 'databases', 'technique', 'database-indexing',
    ['Query Optimization', 'EXPLAIN', 'Query Plans', 'Slow Query Analysis'],
    [edge('database-indexing', 'part_of'), edge('sql', 'requires')]),

  seed('connection-pooling', 'databases', 'technique', 'databases',
    ['Connection Pooling', 'Database Connections', 'Pool Management'],
    [edge('databases', 'part_of')]),

  seed('database-normalization', 'databases', 'technique', 'data-modeling',
    ['Normalization', 'Database Normalization', '1NF', '2NF', '3NF', 'Denormalization'],
    [edge('data-modeling', 'part_of'), edge('relational-databases', 'requires')]),

  // ════════════════════════════════════════════════════════════════════════
  // DOMAIN: devops
  // SWEBOK v4: Software Engineering Operations (Ch 6 — new in v4),
  //            Software Configuration Management (Ch 8)
  // ACM CCS: Software creation and management > Software development process management
  // ════════════════════════════════════════════════════════════════════════

  seed('devops-infrastructure', 'devops', 'domain', null,
    ['DevOps', 'Infrastructure', 'DevOps & Infrastructure', 'Platform Engineering'],
    []),

  // ── Topics ──
  seed('version-control', 'devops', 'topic', 'devops-infrastructure',
    ['Version Control', 'Git', 'Source Control', 'VCS'],
    [edge('devops-infrastructure', 'part_of')]),

  seed('containerization', 'devops', 'topic', 'devops-infrastructure',
    ['Containerization', 'Docker', 'Containers', 'OCI'],
    [edge('devops-infrastructure', 'part_of')]),

  seed('ci-cd', 'devops', 'topic', 'devops-infrastructure',
    ['CI/CD', 'Continuous Integration', 'Continuous Deployment', 'Pipeline'],
    [edge('devops-infrastructure', 'part_of'), edge('version-control', 'requires')]),

  seed('cloud-services', 'devops', 'topic', 'devops-infrastructure',
    ['Cloud Services', 'AWS', 'GCP', 'Azure', 'Cloud Computing'],
    [edge('devops-infrastructure', 'part_of')]),

  seed('monitoring-observability', 'devops', 'topic', 'devops-infrastructure',
    ['Monitoring', 'Observability', 'Logging', 'Metrics', 'Alerting'],
    [edge('devops-infrastructure', 'part_of')]),

  seed('networking-fundamentals', 'devops', 'topic', 'devops-infrastructure',
    ['Networking', 'DNS', 'TCP/IP', 'Load Balancing', 'Networking Fundamentals'],
    [edge('devops-infrastructure', 'part_of')]),

  // ── Techniques ──
  seed('git-branching-strategies', 'devops', 'technique', 'version-control',
    ['Git Branching', 'Git Flow', 'Trunk-Based Development', 'Feature Branches'],
    [edge('version-control', 'part_of'), edge('version-control', 'requires')]),

  seed('docker-compose', 'devops', 'technique', 'containerization',
    ['Docker Compose', 'Multi-Container', 'Container Orchestration Basics'],
    [edge('containerization', 'part_of'), edge('containerization', 'requires')]),

  seed('kubernetes-basics', 'devops', 'technique', 'containerization',
    ['Kubernetes', 'K8s', 'Pods', 'Deployments', 'Services'],
    [edge('containerization', 'requires'), edge('networking-fundamentals', 'requires')]),

  seed('infrastructure-as-code', 'devops', 'technique', 'cloud-services',
    ['IaC', 'Infrastructure as Code', 'Terraform', 'Pulumi', 'CloudFormation'],
    [edge('cloud-services', 'requires')]),

  seed('environment-variables', 'devops', 'technique', 'devops-infrastructure',
    ['Environment Variables', 'Env Vars', 'dotenv', 'Config Management'],
    [edge('devops-infrastructure', 'part_of')]),

  seed('structured-logging', 'devops', 'technique', 'monitoring-observability',
    ['Structured Logging', 'JSON Logging', 'Log Aggregation'],
    [edge('monitoring-observability', 'part_of')]),

  // ════════════════════════════════════════════════════════════════════════
  // DOMAIN: security
  // SWEBOK v4: Software Security (Ch 13 — new in v4)
  // ACM CCS: Security and privacy
  // ════════════════════════════════════════════════════════════════════════

  seed('security-fundamentals', 'security', 'domain', null,
    ['Security', 'Software Security', 'Application Security', 'AppSec'],
    []),

  // ── Topics ──
  seed('authentication-mechanisms', 'security', 'topic', 'security-fundamentals',
    ['Authentication', 'AuthN', 'Identity Verification'],
    [edge('security-fundamentals', 'part_of')]),

  seed('authorization-access-control', 'security', 'topic', 'security-fundamentals',
    ['Authorization', 'AuthZ', 'Access Control', 'RBAC', 'Permissions'],
    [edge('security-fundamentals', 'part_of'), edge('authentication-mechanisms', 'requires')]),

  seed('cryptography-basics', 'security', 'topic', 'security-fundamentals',
    ['Cryptography', 'Encryption', 'Hashing', 'Crypto'],
    [edge('security-fundamentals', 'part_of')]),

  seed('web-security-vulnerabilities', 'security', 'topic', 'security-fundamentals',
    ['Web Security', 'OWASP', 'Web Vulnerabilities', 'OWASP Top 10'],
    [edge('security-fundamentals', 'part_of'), edge('http-protocol', 'requires')]),

  seed('secrets-management', 'security', 'topic', 'security-fundamentals',
    ['Secrets Management', 'Secret Rotation', 'Vault', 'Key Management'],
    [edge('security-fundamentals', 'part_of'), edge('environment-variables', 'related_to')]),

  // ── Techniques ──
  seed('password-hashing', 'security', 'technique', 'cryptography-basics',
    ['Password Hashing', 'bcrypt', 'scrypt', 'Argon2', 'Salt'],
    [edge('cryptography-basics', 'part_of'), edge('authentication-mechanisms', 'related_to')]),

  seed('xss-prevention', 'security', 'technique', 'web-security-vulnerabilities',
    ['XSS Prevention', 'Cross-Site Scripting', 'Output Encoding', 'CSP'],
    [edge('web-security-vulnerabilities', 'part_of'), edge('dom-manipulation', 'related_to')]),

  seed('sql-injection-prevention', 'security', 'technique', 'web-security-vulnerabilities',
    ['SQL Injection', 'SQLi Prevention', 'Parameterized Queries', 'Prepared Statements'],
    [edge('web-security-vulnerabilities', 'part_of'), edge('sql', 'requires')]),

  seed('csrf-protection', 'security', 'technique', 'web-security-vulnerabilities',
    ['CSRF', 'Cross-Site Request Forgery', 'CSRF Tokens'],
    [edge('web-security-vulnerabilities', 'part_of'), edge('http-protocol', 'requires')]),

  seed('tls-https', 'security', 'technique', 'security-fundamentals',
    ['TLS', 'HTTPS', 'SSL', 'Certificate Management'],
    [edge('cryptography-basics', 'requires'), edge('networking-fundamentals', 'related_to')]),

  // ════════════════════════════════════════════════════════════════════════
  // DOMAIN: testing
  // SWEBOK v4: Software Testing (Ch 5)
  // ACM CCS: Software and its engineering > Software verification and validation
  // ════════════════════════════════════════════════════════════════════════

  seed('testing-quality', 'testing', 'domain', null,
    ['Testing', 'Software Testing', 'Quality Assurance', 'QA'],
    []),

  // ── Topics ──
  seed('unit-testing', 'testing', 'topic', 'testing-quality',
    ['Unit Testing', 'Unit Tests', 'Test Cases'],
    [edge('testing-quality', 'part_of')]),

  seed('integration-testing', 'testing', 'topic', 'testing-quality',
    ['Integration Testing', 'Integration Tests'],
    [edge('testing-quality', 'part_of'), edge('unit-testing', 'requires')]),

  seed('end-to-end-testing', 'testing', 'topic', 'testing-quality',
    ['E2E Testing', 'End-to-End Testing', 'Acceptance Testing', 'Cypress', 'Playwright'],
    [edge('testing-quality', 'part_of'), edge('integration-testing', 'requires')]),

  seed('test-design', 'testing', 'topic', 'testing-quality',
    ['Test Design', 'Test Strategy', 'Testing Pyramid', 'Test Coverage'],
    [edge('testing-quality', 'part_of')]),

  // ── Techniques ──
  seed('mocking-stubbing', 'testing', 'technique', 'unit-testing',
    ['Mocking', 'Stubbing', 'Test Doubles', 'Spies', 'Fakes'],
    [edge('unit-testing', 'part_of'), edge('unit-testing', 'requires')]),

  seed('test-driven-development', 'testing', 'technique', 'testing-quality',
    ['TDD', 'Test-Driven Development', 'Red-Green-Refactor'],
    [edge('unit-testing', 'requires'), edge('test-design', 'related_to')]),

  seed('snapshot-testing', 'testing', 'technique', 'unit-testing',
    ['Snapshot Testing', 'Snapshot Tests', 'Visual Regression'],
    [edge('unit-testing', 'part_of'), edge('component-architecture', 'related_to')]),

  seed('fixture-management', 'testing', 'technique', 'unit-testing',
    ['Test Fixtures', 'Factories', 'Seed Data', 'Setup/Teardown'],
    [edge('unit-testing', 'part_of')]),

  seed('property-based-testing', 'testing', 'technique', 'test-design',
    ['Property-Based Testing', 'Fuzzing', 'QuickCheck', 'Hypothesis'],
    [edge('test-design', 'part_of'), edge('unit-testing', 'requires')]),

  // ════════════════════════════════════════════════════════════════════════
  // DOMAIN: system-design
  // SWEBOK v4: Software Architecture (Ch 2 — new in v4), Software Design (Ch 3)
  // ACM CCS: Software organization and properties > Software system structures
  // ════════════════════════════════════════════════════════════════════════

  seed('system-design', 'system-design', 'domain', null,
    ['System Design', 'Software Architecture', 'Architecture'],
    []),

  // ── Topics ──
  seed('design-patterns', 'system-design', 'topic', 'system-design',
    ['Design Patterns', 'GoF Patterns', 'Software Patterns'],
    [edge('system-design', 'part_of'), edge('object-oriented-programming', 'requires')]),

  seed('architectural-patterns', 'system-design', 'topic', 'system-design',
    ['Architectural Patterns', 'Architecture Styles', 'System Architecture'],
    [edge('system-design', 'part_of')]),

  seed('distributed-systems', 'system-design', 'topic', 'system-design',
    ['Distributed Systems', 'Distributed Computing'],
    [edge('system-design', 'part_of'), edge('networking-fundamentals', 'requires')]),

  seed('api-design-principles', 'system-design', 'topic', 'system-design',
    ['API Design', 'API Contracts', 'Interface Design'],
    [edge('system-design', 'part_of')]),

  seed('scalability', 'system-design', 'topic', 'system-design',
    ['Scalability', 'Horizontal Scaling', 'Vertical Scaling', 'Load Balancing'],
    [edge('system-design', 'part_of'), edge('distributed-systems', 'requires')]),

  // ── Techniques ──
  seed('dependency-injection', 'system-design', 'technique', 'design-patterns',
    ['Dependency Injection', 'DI', 'IoC', 'Inversion of Control'],
    [edge('design-patterns', 'part_of'), edge('interfaces-and-protocols', 'requires')]),

  seed('observer-pattern', 'system-design', 'technique', 'design-patterns',
    ['Observer Pattern', 'Pub/Sub', 'Event Emitter', 'Publish-Subscribe'],
    [edge('design-patterns', 'part_of')]),

  seed('strategy-pattern', 'system-design', 'technique', 'design-patterns',
    ['Strategy Pattern', 'Policy Pattern'],
    [edge('design-patterns', 'part_of'), edge('interfaces-and-protocols', 'requires')]),

  seed('microservices', 'system-design', 'technique', 'architectural-patterns',
    ['Microservices', 'Service-Oriented Architecture', 'SOA'],
    [edge('architectural-patterns', 'part_of'), edge('distributed-systems', 'requires'),
     edge('rest-api-design', 'requires')]),

  seed('event-driven-architecture', 'system-design', 'technique', 'architectural-patterns',
    ['Event-Driven Architecture', 'EDA', 'Message Queues', 'Event Sourcing'],
    [edge('architectural-patterns', 'part_of'), edge('observer-pattern', 'related_to'),
     edge('async-programming', 'requires')]),

  seed('monorepo-structure', 'system-design', 'technique', 'system-design',
    ['Monorepo', 'Mono Repository', 'Workspace', 'Turborepo', 'Nx'],
    [edge('system-design', 'part_of'), edge('build-tools', 'related_to')]),

  seed('clean-architecture', 'system-design', 'technique', 'architectural-patterns',
    ['Clean Architecture', 'Hexagonal Architecture', 'Ports and Adapters', 'Onion Architecture'],
    [edge('architectural-patterns', 'part_of'), edge('dependency-injection', 'requires'),
     edge('interfaces-and-protocols', 'requires')]),

  seed('cqrs', 'system-design', 'technique', 'architectural-patterns',
    ['CQRS', 'Command Query Responsibility Segregation'],
    [edge('architectural-patterns', 'part_of'), edge('event-driven-architecture', 'related_to')]),

  seed('message-queues', 'system-design', 'technique', 'distributed-systems',
    ['Message Queues', 'Message Broker', 'RabbitMQ', 'Kafka', 'BullMQ'],
    [edge('distributed-systems', 'part_of'), edge('async-programming', 'requires')]),

  // ════════════════════════════════════════════════════════════════════════
  // DOMAIN: ai-ml
  // SWEBOK v4: Computing Foundations (AI/ML topics, new in v4)
  // ACM CCS: Computing methodologies > Artificial intelligence / Machine learning
  // ════════════════════════════════════════════════════════════════════════

  seed('ai-machine-learning', 'ai-ml', 'domain', null,
    ['AI/ML', 'Artificial Intelligence', 'Machine Learning'],
    []),

  // ── Topics ──
  seed('llm-fundamentals', 'ai-ml', 'topic', 'ai-machine-learning',
    ['LLM', 'Large Language Models', 'Language Models', 'GPT', 'Claude'],
    [edge('ai-machine-learning', 'part_of')]),

  seed('prompt-engineering', 'ai-ml', 'topic', 'ai-machine-learning',
    ['Prompt Engineering', 'Prompt Design', 'Few-Shot Prompting'],
    [edge('ai-machine-learning', 'part_of'), edge('llm-fundamentals', 'requires')]),

  seed('embeddings-vectors', 'ai-ml', 'topic', 'ai-machine-learning',
    ['Embeddings', 'Vector Embeddings', 'Vector Databases', 'Semantic Search'],
    [edge('ai-machine-learning', 'part_of')]),

  seed('supervised-learning', 'ai-ml', 'topic', 'ai-machine-learning',
    ['Supervised Learning', 'Classification', 'Regression'],
    [edge('ai-machine-learning', 'part_of')]),

  seed('neural-networks', 'ai-ml', 'topic', 'ai-machine-learning',
    ['Neural Networks', 'Deep Learning', 'Layers', 'Backpropagation'],
    [edge('ai-machine-learning', 'part_of'), edge('supervised-learning', 'requires')]),

  // ── Techniques ──
  seed('rag-pattern', 'ai-ml', 'technique', 'llm-fundamentals',
    ['RAG', 'Retrieval-Augmented Generation'],
    [edge('llm-fundamentals', 'requires'), edge('embeddings-vectors', 'requires')]),

  seed('llm-function-calling', 'ai-ml', 'technique', 'llm-fundamentals',
    ['Function Calling', 'Tool Use', 'LLM Tool Use', 'Agent Tools'],
    [edge('llm-fundamentals', 'requires'), edge('rest-api-design', 'related_to')]),

  seed('fine-tuning', 'ai-ml', 'technique', 'neural-networks',
    ['Fine-Tuning', 'Transfer Learning', 'LoRA', 'Model Fine-Tuning'],
    [edge('neural-networks', 'requires'), edge('supervised-learning', 'requires')]),

  seed('model-evaluation', 'ai-ml', 'technique', 'supervised-learning',
    ['Model Evaluation', 'Precision/Recall', 'F1 Score', 'Confusion Matrix'],
    [edge('supervised-learning', 'part_of')]),

  seed('streaming-responses', 'ai-ml', 'technique', 'llm-fundamentals',
    ['Streaming', 'SSE', 'Streaming Responses', 'Server-Sent Events'],
    [edge('llm-fundamentals', 'related_to'), edge('async-programming', 'requires')]),

  seed('ai-agent-patterns', 'ai-ml', 'technique', 'llm-fundamentals',
    ['AI Agents', 'Agent Patterns', 'ReAct', 'Chain of Thought', 'Agentic Workflows'],
    [edge('llm-fundamentals', 'requires'), edge('llm-function-calling', 'requires'),
     edge('prompt-engineering', 'requires')]),
];

// ── Build ConceptNode records from seeds ───────────────────────────────

/**
 * Convert seed concepts into full ConceptNode records suitable for
 * insertion into the KnowledgeGraphState.
 *
 * All seed concepts enter at lifecycle='stable' since they are
 * human-curated reference concepts, not dynamically discovered.
 */
export function buildSeedConceptNodes(): Record<string, ConceptNode> {
  const nodes: Record<string, ConceptNode> = {};

  for (const s of SEED_CONCEPTS) {
    nodes[s.conceptId] = {
      conceptId: s.conceptId,
      aliases: s.aliases,
      domain: s.domain,
      specificity: s.specificity,
      parentConcept: s.parentConcept,
      itemParams: { ...DEFAULT_GRM_PARAMS },
      relationships: s.relationships,
      lifecycle: 'stable',
      populationStats: { meanMastery: 0, assessmentCount: 0, failureRate: 0 },
    };
  }

  return nodes;
}

// ── Stats ──────────────────────────────────────────────────────────────

/**
 * Return summary statistics for the seed taxonomy.
 */
export function seedTaxonomyStats(): {
  total: number;
  domains: number;
  topics: number;
  techniques: number;
  domainNames: string[];
} {
  const domains = SEED_CONCEPTS.filter(c => c.specificity === 'domain');
  const topics = SEED_CONCEPTS.filter(c => c.specificity === 'topic');
  const techniques = SEED_CONCEPTS.filter(c => c.specificity === 'technique');

  return {
    total: SEED_CONCEPTS.length,
    domains: domains.length,
    topics: topics.length,
    techniques: techniques.length,
    domainNames: domains.map(d => d.conceptId),
  };
}
