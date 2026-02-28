/**
 * Seed Concept Taxonomy for Entendi Knowledge Graph
 *
 * ~130 curated seed concepts covering 10 domains. These form the stable
 * backbone of the knowledge graph. All seeds enter at lifecycle='stable'.
 *
 * Structural inspiration:
 *   - SWEBOK v4 (IEEE Software Engineering Body of Knowledge, 2024)
 *   - ACM CCS 2012 (Computing Classification System)
 *
 * Constraints:
 *   - Three specificity tiers: domain > topic > technique
 *   - Parent chains form a DAG (no cycles)
 *   - All relationship targets reference existing concept IDs
 *   - Domain names align with package-concepts.ts where possible
 */

import { type ConceptEdge, type ConceptNode, type ConceptSpecificity, createConceptNode, type EdgeType, type TaxonomySeedEntry } from '../schemas/types.js';

// ── Shorthand helpers ─────────────────────────────────────────────────

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
): TaxonomySeedEntry {
  return { conceptId, aliases, domain, specificity, parentConcept, relationships };
}

// ══════════════════════════════════════════════════════════════════════
// SEED CONCEPTS (~130)
// ══════════════════════════════════════════════════════════════════════

export const SEED_CONCEPTS: TaxonomySeedEntry[] = [

  // ════════════════════════════════════════════════════════════════════
  // DOMAIN 1: programming-languages (18 concepts)
  // ════════════════════════════════════════════════════════════════════

  seed('programming-languages', 'programming-languages', 'domain', null,
    ['Programming Languages', 'PLs', 'Languages'],
    []),

  // ── Topics ──
  seed('variables-and-scope', 'programming-languages', 'topic', 'programming-languages',
    ['Variables', 'Scope', 'Variable Scope', 'Lexical Scope'],
    [edge('programming-languages', 'part_of')]),

  seed('control-flow', 'programming-languages', 'topic', 'programming-languages',
    ['Control Flow', 'Conditionals', 'Loops', 'Branching'],
    [edge('programming-languages', 'part_of'), edge('variables-and-scope', 'requires')]),

  seed('functions', 'programming-languages', 'topic', 'programming-languages',
    ['Functions', 'Procedures', 'Subroutines', 'Methods'],
    [edge('programming-languages', 'part_of'), edge('variables-and-scope', 'requires')]),

  seed('type-systems', 'programming-languages', 'topic', 'programming-languages',
    ['Type Systems', 'Typing', 'Type Theory'],
    [edge('programming-languages', 'part_of')]),

  seed('object-oriented-programming', 'programming-languages', 'topic', 'programming-languages',
    ['OOP', 'Object-Oriented', 'Object Oriented Programming'],
    [edge('programming-languages', 'part_of'), edge('functions', 'requires')]),

  seed('functional-programming', 'programming-languages', 'topic', 'programming-languages',
    ['FP', 'Functional', 'Functional Programming'],
    [edge('programming-languages', 'part_of'), edge('functions', 'requires')]),

  seed('async-programming', 'programming-languages', 'topic', 'programming-languages',
    ['Asynchronous Programming', 'Async/Await', 'Async Programming'],
    [edge('programming-languages', 'part_of'), edge('functions', 'requires')]),

  seed('error-handling', 'programming-languages', 'topic', 'programming-languages',
    ['Error Handling', 'Exception Handling', 'Errors'],
    [edge('programming-languages', 'part_of'), edge('control-flow', 'requires')]),

  seed('memory-management', 'programming-languages', 'topic', 'programming-languages',
    ['Memory Management', 'Garbage Collection', 'Memory'],
    [edge('programming-languages', 'part_of')]),

  seed('modules-and-imports', 'programming-languages', 'topic', 'programming-languages',
    ['Modules', 'Imports', 'Module System', 'Package Management'],
    [edge('programming-languages', 'part_of')]),

  // ── Techniques ──
  seed('closures', 'programming-languages', 'technique', 'functional-programming',
    ['Closures', 'Lexical Closures', 'Closure'],
    [edge('functional-programming', 'part_of'), edge('variables-and-scope', 'requires')]),

  seed('higher-order-functions', 'programming-languages', 'technique', 'functional-programming',
    ['Higher-Order Functions', 'HOF', 'Map/Filter/Reduce'],
    [edge('functional-programming', 'part_of'), edge('closures', 'related_to')]),

  seed('generics', 'programming-languages', 'technique', 'type-systems',
    ['Generics', 'Generic Types', 'Parametric Polymorphism', 'Type Parameters'],
    [edge('type-systems', 'part_of'), edge('type-systems', 'requires')]),

  seed('decorators-metaprogramming', 'programming-languages', 'technique', 'programming-languages',
    ['Decorators', 'Metaprogramming', 'Annotations', 'Reflection'],
    [edge('programming-languages', 'part_of'), edge('higher-order-functions', 'related_to')]),

  seed('iterators-generators', 'programming-languages', 'technique', 'programming-languages',
    ['Iterators', 'Generators', 'Yield', 'Iterator Protocol'],
    [edge('programming-languages', 'part_of'), edge('closures', 'related_to')]),

  seed('pattern-matching', 'programming-languages', 'technique', 'control-flow',
    ['Pattern Matching', 'Destructuring', 'Switch Expressions'],
    [edge('control-flow', 'part_of'), edge('type-systems', 'related_to')]),

  seed('concurrency-primitives', 'programming-languages', 'technique', 'async-programming',
    ['Concurrency', 'Threads', 'Locks', 'Mutexes', 'Semaphores'],
    [edge('async-programming', 'part_of')]),

  seed('event-loop', 'programming-languages', 'technique', 'async-programming',
    ['Event Loop', 'Event-Driven', 'Non-Blocking I/O'],
    [edge('async-programming', 'part_of')]),

  seed('regular-expressions', 'programming-languages', 'technique', 'programming-languages',
    ['Regular Expressions', 'Regex', 'RegExp', 'Pattern Matching with Regex'],
    [edge('programming-languages', 'part_of')]),

  // ════════════════════════════════════════════════════════════════════
  // DOMAIN 2: data-structures-algorithms (11 concepts)
  // ════════════════════════════════════════════════════════════════════

  seed('data-structures-algorithms', 'data-structures-algorithms', 'domain', null,
    ['Data Structures & Algorithms', 'DSA', 'Algorithms'],
    []),

  // ── Topics ──
  seed('arrays-and-lists', 'data-structures-algorithms', 'topic', 'data-structures-algorithms',
    ['Arrays', 'Lists', 'Linked Lists', 'Array Operations'],
    [edge('data-structures-algorithms', 'part_of')]),

  seed('hash-maps', 'data-structures-algorithms', 'topic', 'data-structures-algorithms',
    ['Hash Maps', 'Hash Tables', 'Dictionaries', 'Sets'],
    [edge('data-structures-algorithms', 'part_of')]),

  seed('trees', 'data-structures-algorithms', 'topic', 'data-structures-algorithms',
    ['Trees', 'Binary Trees', 'BST', 'Tree Data Structures'],
    [edge('data-structures-algorithms', 'part_of'), edge('arrays-and-lists', 'requires')]),

  seed('graphs', 'data-structures-algorithms', 'topic', 'data-structures-algorithms',
    ['Graphs', 'Graph Data Structures', 'Adjacency List', 'Adjacency Matrix'],
    [edge('data-structures-algorithms', 'part_of'), edge('trees', 'requires')]),

  seed('stacks-and-queues', 'data-structures-algorithms', 'topic', 'data-structures-algorithms',
    ['Stacks', 'Queues', 'LIFO', 'FIFO', 'Deque'],
    [edge('data-structures-algorithms', 'part_of'), edge('arrays-and-lists', 'related_to')]),

  seed('sorting-algorithms', 'data-structures-algorithms', 'topic', 'data-structures-algorithms',
    ['Sorting', 'Sort Algorithms', 'Quicksort', 'Mergesort'],
    [edge('data-structures-algorithms', 'part_of')]),

  seed('big-o-complexity', 'data-structures-algorithms', 'topic', 'data-structures-algorithms',
    ['Big O', 'Complexity Analysis', 'Time Complexity', 'Space Complexity'],
    [edge('data-structures-algorithms', 'part_of')]),

  // ── Techniques ──
  seed('searching-algorithms', 'data-structures-algorithms', 'technique', 'data-structures-algorithms',
    ['Searching', 'Binary Search', 'Linear Search', 'Search Algorithms'],
    [edge('data-structures-algorithms', 'part_of'), edge('big-o-complexity', 'related_to')]),

  seed('recursion', 'data-structures-algorithms', 'technique', 'data-structures-algorithms',
    ['Recursion', 'Recursive Algorithms', 'Base Case'],
    [edge('data-structures-algorithms', 'part_of'), edge('functions', 'requires')]),

  seed('dynamic-programming', 'data-structures-algorithms', 'technique', 'data-structures-algorithms',
    ['Dynamic Programming', 'DP', 'Memoization'],
    [edge('recursion', 'requires'), edge('big-o-complexity', 'requires')]),

  seed('graph-algorithms', 'data-structures-algorithms', 'technique', 'graphs',
    ['Graph Algorithms', 'BFS', 'DFS', 'Dijkstra', 'Graph Traversal'],
    [edge('graphs', 'requires'), edge('recursion', 'related_to')]),

  // ════════════════════════════════════════════════════════════════════
  // DOMAIN 3: web-development (14 concepts)
  // ════════════════════════════════════════════════════════════════════

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

  seed('websockets', 'web-development', 'topic', 'web-development',
    ['WebSockets', 'Real-Time Communication', 'Socket.IO', 'WS'],
    [edge('web-development', 'part_of'), edge('http-protocol', 'requires')]),

  seed('authentication-authorization', 'web-development', 'topic', 'web-development',
    ['Auth', 'Authentication', 'Authorization', 'AuthN/AuthZ'],
    [edge('web-development', 'part_of'), edge('http-protocol', 'requires')]),

  seed('middleware-pattern', 'web-development', 'topic', 'web-development',
    ['Middleware', 'Middleware Pattern', 'Request Pipeline'],
    [edge('web-development', 'part_of'), edge('http-protocol', 'requires')]),

  seed('routing', 'web-development', 'topic', 'web-development',
    ['Routing', 'URL Routing', 'Route Handlers', 'Express Routes'],
    [edge('web-development', 'part_of'), edge('http-protocol', 'requires')]),

  seed('server-side-rendering', 'web-development', 'topic', 'web-development',
    ['SSR', 'Server-Side Rendering', 'Server Rendering'],
    [edge('web-development', 'part_of'), edge('http-protocol', 'requires')]),

  seed('web-security', 'web-development', 'topic', 'web-development',
    ['Web Security', 'OWASP', 'Web Vulnerabilities'],
    [edge('web-development', 'part_of'), edge('http-protocol', 'requires')]),

  // ── Techniques ──
  seed('jwt-tokens', 'web-development', 'technique', 'authentication-authorization',
    ['JWT', 'JSON Web Token', 'Bearer Token'],
    [edge('authentication-authorization', 'part_of'), edge('authentication-authorization', 'requires')]),

  seed('oauth-flow', 'web-development', 'technique', 'authentication-authorization',
    ['OAuth', 'OAuth 2.0', 'OpenID Connect', 'OIDC'],
    [edge('authentication-authorization', 'part_of'), edge('jwt-tokens', 'related_to')]),

  seed('session-management', 'web-development', 'technique', 'authentication-authorization',
    ['Sessions', 'Session Management', 'Cookies', 'Session Store'],
    [edge('authentication-authorization', 'part_of'), edge('http-protocol', 'requires')]),

  seed('cors', 'web-development', 'technique', 'web-development',
    ['CORS', 'Cross-Origin Resource Sharing', 'Same-Origin Policy'],
    [edge('http-protocol', 'requires'), edge('middleware-pattern', 'related_to')]),

  seed('rate-limiting', 'web-development', 'technique', 'web-development',
    ['Rate Limiting', 'Throttling', 'API Rate Limits'],
    [edge('middleware-pattern', 'related_to'), edge('http-protocol', 'requires')]),

  // ════════════════════════════════════════════════════════════════════
  // DOMAIN 4: frontend (12 concepts)
  // ════════════════════════════════════════════════════════════════════

  seed('frontend-development', 'frontend', 'domain', null,
    ['Frontend Development', 'Frontend', 'Client-Side Development', 'UI Development'],
    []),

  // ── Topics ──
  seed('dom-manipulation', 'frontend', 'topic', 'frontend-development',
    ['DOM', 'DOM Manipulation', 'Document Object Model'],
    [edge('frontend-development', 'part_of')]),

  seed('component-architecture', 'frontend', 'topic', 'frontend-development',
    ['Component Architecture', 'Component-Based UI', 'UI Components', 'React'],
    [edge('frontend-development', 'part_of'), edge('dom-manipulation', 'requires')]),

  seed('state-management', 'frontend', 'topic', 'frontend-development',
    ['State Management', 'Application State', 'Redux', 'Global State'],
    [edge('frontend-development', 'part_of'), edge('component-architecture', 'requires')]),

  seed('css-layout', 'frontend', 'topic', 'frontend-development',
    ['CSS Layout', 'Flexbox', 'CSS Grid', 'Box Model'],
    [edge('frontend-development', 'part_of')]),

  seed('responsive-design', 'frontend', 'topic', 'frontend-development',
    ['Responsive Design', 'Media Queries', 'Mobile-First', 'Adaptive Layout'],
    [edge('frontend-development', 'part_of'), edge('css-layout', 'requires')]),

  seed('client-side-routing', 'frontend', 'topic', 'frontend-development',
    ['Client-Side Routing', 'SPA Routing', 'Router'],
    [edge('frontend-development', 'part_of'), edge('component-architecture', 'requires')]),

  seed('browser-apis', 'frontend', 'topic', 'frontend-development',
    ['Browser APIs', 'Fetch API', 'Storage API', 'Web Workers'],
    [edge('frontend-development', 'part_of'), edge('dom-manipulation', 'related_to')]),

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

  seed('accessibility', 'frontend', 'technique', 'frontend-development',
    ['Accessibility', 'a11y', 'ARIA', 'Screen Readers', 'WCAG'],
    [edge('frontend-development', 'part_of'), edge('dom-manipulation', 'related_to')]),

  seed('css-in-js', 'frontend', 'technique', 'css-layout',
    ['CSS-in-JS', 'Styled Components', 'Tailwind', 'CSS Modules'],
    [edge('css-layout', 'part_of')]),

  // ════════════════════════════════════════════════════════════════════
  // DOMAIN 5: databases (12 concepts)
  // ════════════════════════════════════════════════════════════════════

  seed('databases', 'databases', 'domain', null,
    ['Databases', 'Data Storage', 'Data Persistence'],
    []),

  // ── Topics ──
  seed('sql', 'databases', 'topic', 'databases',
    ['SQL', 'Structured Query Language', 'SQL Queries'],
    [edge('databases', 'part_of')]),

  seed('database-design', 'databases', 'topic', 'databases',
    ['Database Design', 'Schema Design', 'Entity Relationships', 'ER Diagrams'],
    [edge('databases', 'part_of')]),

  seed('database-indexing', 'databases', 'topic', 'databases',
    ['Database Indexes', 'Indexing', 'B-Tree Index'],
    [edge('databases', 'part_of'), edge('sql', 'requires')]),

  seed('transactions-acid', 'databases', 'topic', 'databases',
    ['Transactions', 'ACID', 'Atomicity', 'Isolation Levels'],
    [edge('databases', 'part_of'), edge('sql', 'requires')]),

  seed('nosql-databases', 'databases', 'topic', 'databases',
    ['NoSQL', 'NoSQL Databases', 'Document Databases', 'MongoDB'],
    [edge('databases', 'part_of'), edge('sql', 'alternative_to')]),

  seed('data-modeling', 'databases', 'topic', 'databases',
    ['Data Modeling', 'Data Models', 'Schema Modeling'],
    [edge('databases', 'part_of'), edge('database-design', 'related_to')]),

  // ── Techniques ──
  seed('orm-usage', 'databases', 'technique', 'databases',
    ['ORM', 'Object-Relational Mapping', 'Prisma', 'Drizzle', 'TypeORM'],
    [edge('sql', 'requires'), edge('database-design', 'related_to')]),

  seed('query-optimization', 'databases', 'technique', 'database-indexing',
    ['Query Optimization', 'EXPLAIN', 'Query Plans', 'Slow Query Analysis'],
    [edge('database-indexing', 'part_of'), edge('sql', 'requires')]),

  seed('database-migrations', 'databases', 'technique', 'databases',
    ['Database Migrations', 'Schema Migrations', 'Migration Scripts'],
    [edge('database-design', 'requires'), edge('orm-usage', 'related_to')]),

  seed('connection-pooling', 'databases', 'technique', 'databases',
    ['Connection Pooling', 'Database Connections', 'Pool Management'],
    [edge('databases', 'part_of')]),

  seed('database-replication', 'databases', 'technique', 'databases',
    ['Replication', 'Database Replication', 'Read Replicas', 'Primary/Replica'],
    [edge('databases', 'part_of'), edge('transactions-acid', 'related_to')]),

  seed('database-caching', 'databases', 'technique', 'databases',
    ['Database Caching', 'Redis Cache', 'Cache Aside', 'Write-Through Cache'],
    [edge('databases', 'part_of'), edge('query-optimization', 'related_to')]),

  // ════════════════════════════════════════════════════════════════════
  // DOMAIN 6: system-design (14 concepts)
  // ════════════════════════════════════════════════════════════════════

  seed('system-design', 'system-design', 'domain', null,
    ['System Design', 'Software Architecture', 'Architecture'],
    []),

  // ── Topics ──
  seed('distributed-systems', 'system-design', 'topic', 'system-design',
    ['Distributed Systems', 'Distributed Computing'],
    [edge('system-design', 'part_of')]),

  seed('design-patterns', 'system-design', 'topic', 'system-design',
    ['Design Patterns', 'GoF Patterns', 'Software Patterns'],
    [edge('system-design', 'part_of'), edge('object-oriented-programming', 'requires')]),

  seed('architectural-patterns', 'system-design', 'topic', 'system-design',
    ['Architectural Patterns', 'Architecture Styles', 'System Architecture'],
    [edge('system-design', 'part_of')]),

  seed('api-design-principles', 'system-design', 'topic', 'system-design',
    ['API Design', 'API Contracts', 'Interface Design'],
    [edge('system-design', 'part_of')]),

  seed('cap-theorem', 'system-design', 'topic', 'distributed-systems',
    ['CAP Theorem', 'Consistency', 'Availability', 'Partition Tolerance'],
    [edge('distributed-systems', 'part_of')]),

  // ── Techniques ──
  seed('microservices', 'system-design', 'technique', 'architectural-patterns',
    ['Microservices', 'Service-Oriented Architecture', 'SOA'],
    [edge('architectural-patterns', 'part_of'), edge('distributed-systems', 'requires'),
     edge('rest-api-design', 'requires')]),

  seed('message-queues', 'system-design', 'technique', 'distributed-systems',
    ['Message Queues', 'Message Broker', 'RabbitMQ', 'Kafka', 'BullMQ'],
    [edge('distributed-systems', 'part_of'), edge('async-programming', 'requires')]),

  seed('load-balancing', 'system-design', 'technique', 'distributed-systems',
    ['Load Balancing', 'Load Balancer', 'Round Robin', 'Health Checks'],
    [edge('distributed-systems', 'part_of')]),

  seed('caching-strategy', 'system-design', 'technique', 'system-design',
    ['Caching Strategy', 'Cache Invalidation', 'CDN', 'In-Memory Cache'],
    [edge('system-design', 'part_of')]),

  seed('api-gateway', 'system-design', 'technique', 'architectural-patterns',
    ['API Gateway', 'Gateway Pattern', 'Reverse Proxy'],
    [edge('architectural-patterns', 'part_of'), edge('microservices', 'related_to')]),

  seed('event-driven-architecture', 'system-design', 'technique', 'architectural-patterns',
    ['Event-Driven Architecture', 'EDA', 'Event Sourcing'],
    [edge('architectural-patterns', 'part_of'), edge('message-queues', 'related_to'),
     edge('async-programming', 'requires')]),

  seed('circuit-breaker', 'system-design', 'technique', 'distributed-systems',
    ['Circuit Breaker', 'Bulkhead', 'Resilience Patterns'],
    [edge('distributed-systems', 'part_of'), edge('error-handling', 'related_to')]),

  seed('service-discovery', 'system-design', 'technique', 'distributed-systems',
    ['Service Discovery', 'Service Registry', 'DNS-Based Discovery'],
    [edge('distributed-systems', 'part_of'), edge('microservices', 'related_to')]),

  seed('cqrs', 'system-design', 'technique', 'architectural-patterns',
    ['CQRS', 'Command Query Responsibility Segregation'],
    [edge('architectural-patterns', 'part_of'), edge('event-driven-architecture', 'related_to')]),

  seed('eventual-consistency', 'system-design', 'technique', 'distributed-systems',
    ['Eventual Consistency', 'BASE', 'Conflict Resolution'],
    [edge('distributed-systems', 'part_of'), edge('cap-theorem', 'requires')]),

  // ════════════════════════════════════════════════════════════════════
  // DOMAIN 7: devops (13 concepts)
  // ════════════════════════════════════════════════════════════════════

  seed('devops-infrastructure', 'devops', 'domain', null,
    ['DevOps', 'Infrastructure', 'DevOps & Infrastructure', 'Platform Engineering'],
    []),

  // ── Topics ──
  seed('containerization', 'devops', 'topic', 'devops-infrastructure',
    ['Docker', 'Containerization', 'Containers', 'OCI'],
    [edge('devops-infrastructure', 'part_of')]),

  seed('container-orchestration', 'devops', 'topic', 'devops-infrastructure',
    ['Container Orchestration', 'Kubernetes', 'K8s', 'Pods'],
    [edge('devops-infrastructure', 'part_of'), edge('containerization', 'requires')]),

  seed('ci-cd', 'devops', 'topic', 'devops-infrastructure',
    ['CI/CD', 'Continuous Integration', 'Continuous Deployment', 'Pipeline'],
    [edge('devops-infrastructure', 'part_of')]),

  seed('infrastructure-as-code', 'devops', 'topic', 'devops-infrastructure',
    ['IaC', 'Infrastructure as Code', 'Terraform', 'Pulumi', 'CloudFormation'],
    [edge('devops-infrastructure', 'part_of')]),

  seed('monitoring-observability', 'devops', 'topic', 'devops-infrastructure',
    ['Monitoring', 'Observability', 'Metrics', 'Alerting'],
    [edge('devops-infrastructure', 'part_of')]),

  seed('logging', 'devops', 'topic', 'devops-infrastructure',
    ['Logging', 'Structured Logging', 'Log Aggregation', 'Log Management'],
    [edge('devops-infrastructure', 'part_of'), edge('monitoring-observability', 'related_to')]),

  seed('linux-fundamentals', 'devops', 'topic', 'devops-infrastructure',
    ['Linux', 'Linux Administration', 'Shell Scripting', 'Unix'],
    [edge('devops-infrastructure', 'part_of')]),

  seed('networking-fundamentals', 'devops', 'topic', 'devops-infrastructure',
    ['Networking', 'TCP/IP', 'Networking Fundamentals'],
    [edge('devops-infrastructure', 'part_of')]),

  seed('dns', 'devops', 'topic', 'networking-fundamentals',
    ['DNS', 'Domain Name System', 'DNS Resolution', 'DNS Records'],
    [edge('networking-fundamentals', 'part_of')]),

  // ── Techniques ──
  seed('tls-ssl', 'devops', 'technique', 'networking-fundamentals',
    ['TLS', 'SSL', 'HTTPS Certificates', 'Certificate Management'],
    [edge('networking-fundamentals', 'part_of')]),

  seed('environment-management', 'devops', 'technique', 'devops-infrastructure',
    ['Environment Variables', 'Env Management', 'dotenv', 'Config Management'],
    [edge('devops-infrastructure', 'part_of')]),

  seed('secrets-management-devops', 'devops', 'technique', 'devops-infrastructure',
    ['Secrets Management', 'Vault', 'Secret Rotation', 'Key Management'],
    [edge('devops-infrastructure', 'part_of'), edge('environment-management', 'related_to')]),

  // ════════════════════════════════════════════════════════════════════
  // DOMAIN 8: testing (10 concepts)
  // ════════════════════════════════════════════════════════════════════

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

  seed('test-driven-development', 'testing', 'topic', 'testing-quality',
    ['TDD', 'Test-Driven Development', 'Red-Green-Refactor'],
    [edge('testing-quality', 'part_of'), edge('unit-testing', 'requires')]),

  seed('test-coverage', 'testing', 'topic', 'testing-quality',
    ['Test Coverage', 'Code Coverage', 'Coverage Reports', 'Branch Coverage'],
    [edge('testing-quality', 'part_of'), edge('unit-testing', 'related_to')]),

  // ── Techniques ──
  seed('mocking-stubbing', 'testing', 'technique', 'unit-testing',
    ['Mocking', 'Stubbing', 'Test Doubles', 'Spies', 'Fakes'],
    [edge('unit-testing', 'part_of'), edge('unit-testing', 'requires')]),

  seed('e2e-testing', 'testing', 'technique', 'testing-quality',
    ['E2E Testing', 'End-to-End Testing', 'Cypress', 'Playwright'],
    [edge('testing-quality', 'part_of'), edge('integration-testing', 'requires')]),

  seed('property-based-testing', 'testing', 'technique', 'testing-quality',
    ['Property-Based Testing', 'Fuzzing', 'QuickCheck', 'Hypothesis'],
    [edge('testing-quality', 'part_of'), edge('unit-testing', 'requires')]),

  seed('regression-testing', 'testing', 'technique', 'testing-quality',
    ['Regression Testing', 'Regression Tests', 'Non-Regression'],
    [edge('testing-quality', 'part_of'), edge('test-coverage', 'related_to')]),

  seed('snapshot-testing', 'testing', 'technique', 'unit-testing',
    ['Snapshot Testing', 'Snapshot Tests', 'Visual Regression'],
    [edge('unit-testing', 'part_of'), edge('component-architecture', 'related_to')]),

  seed('performance-testing', 'testing', 'technique', 'testing-quality',
    ['Performance Testing', 'Load Testing', 'Benchmarking', 'Stress Testing'],
    [edge('testing-quality', 'part_of')]),

  // ════════════════════════════════════════════════════════════════════
  // DOMAIN 9: security (10 concepts)
  // ════════════════════════════════════════════════════════════════════

  seed('security-fundamentals', 'security', 'domain', null,
    ['Security', 'Software Security', 'Application Security', 'AppSec'],
    []),

  // ── Topics ──
  seed('input-validation', 'security', 'topic', 'security-fundamentals',
    ['Input Validation', 'Data Validation', 'Sanitization'],
    [edge('security-fundamentals', 'part_of')]),

  seed('encryption-fundamentals', 'security', 'topic', 'security-fundamentals',
    ['Encryption', 'Symmetric Encryption', 'Asymmetric Encryption', 'AES', 'RSA'],
    [edge('security-fundamentals', 'part_of')]),

  seed('hashing', 'security', 'topic', 'security-fundamentals',
    ['Hashing', 'Cryptographic Hashing', 'SHA', 'MD5'],
    [edge('security-fundamentals', 'part_of'), edge('encryption-fundamentals', 'related_to')]),

  seed('owasp-top-ten', 'security', 'topic', 'security-fundamentals',
    ['OWASP Top 10', 'OWASP', 'Common Vulnerabilities'],
    [edge('security-fundamentals', 'part_of')]),

  // ── Techniques ──
  seed('sql-injection-prevention', 'security', 'technique', 'owasp-top-ten',
    ['SQL Injection', 'SQLi Prevention', 'Parameterized Queries', 'Prepared Statements'],
    [edge('owasp-top-ten', 'part_of'), edge('sql', 'requires'), edge('input-validation', 'related_to')]),

  seed('xss-prevention', 'security', 'technique', 'owasp-top-ten',
    ['XSS Prevention', 'Cross-Site Scripting', 'Output Encoding', 'CSP'],
    [edge('owasp-top-ten', 'part_of'), edge('dom-manipulation', 'related_to')]),

  seed('csrf-protection', 'security', 'technique', 'owasp-top-ten',
    ['CSRF', 'Cross-Site Request Forgery', 'CSRF Tokens'],
    [edge('owasp-top-ten', 'part_of'), edge('http-protocol', 'requires')]),

  seed('secure-authentication', 'security', 'technique', 'security-fundamentals',
    ['Secure Auth', 'Password Hashing', 'bcrypt', 'Argon2'],
    [edge('security-fundamentals', 'part_of'), edge('hashing', 'requires'),
     edge('authentication-authorization', 'related_to')]),

  seed('rbac', 'security', 'technique', 'security-fundamentals',
    ['RBAC', 'Role-Based Access Control', 'Permissions', 'Access Control'],
    [edge('security-fundamentals', 'part_of'), edge('authentication-authorization', 'related_to')]),

  seed('dependency-scanning', 'security', 'technique', 'security-fundamentals',
    ['Dependency Scanning', 'Vulnerability Scanning', 'npm audit', 'Snyk'],
    [edge('security-fundamentals', 'part_of'), edge('modules-and-imports', 'related_to')]),

  // ════════════════════════════════════════════════════════════════════
  // DOMAIN 10: ai-ml (12 concepts)
  // ════════════════════════════════════════════════════════════════════

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

  seed('nlp', 'ai-ml', 'topic', 'ai-machine-learning',
    ['NLP', 'Natural Language Processing', 'Text Processing', 'Tokenization'],
    [edge('ai-machine-learning', 'part_of')]),

  // ── Techniques ──
  seed('rag-pattern', 'ai-ml', 'technique', 'llm-fundamentals',
    ['RAG', 'Retrieval-Augmented Generation'],
    [edge('llm-fundamentals', 'requires'), edge('embeddings-vectors', 'requires')]),

  seed('fine-tuning', 'ai-ml', 'technique', 'neural-networks',
    ['Fine-Tuning', 'Transfer Learning', 'LoRA', 'Model Fine-Tuning'],
    [edge('neural-networks', 'requires'), edge('supervised-learning', 'requires')]),

  seed('token-management', 'ai-ml', 'technique', 'llm-fundamentals',
    ['Token Management', 'Context Window', 'Token Counting', 'Tokenization'],
    [edge('llm-fundamentals', 'part_of')]),

  seed('model-evaluation', 'ai-ml', 'technique', 'supervised-learning',
    ['Model Evaluation', 'Precision/Recall', 'F1 Score', 'Confusion Matrix'],
    [edge('supervised-learning', 'part_of')]),

  seed('ai-agents', 'ai-ml', 'technique', 'llm-fundamentals',
    ['AI Agents', 'Agent Patterns', 'ReAct', 'Agentic Workflows'],
    [edge('llm-fundamentals', 'requires'), edge('prompt-engineering', 'requires')]),

  seed('ai-ethics', 'ai-ml', 'technique', 'ai-machine-learning',
    ['AI Ethics', 'Responsible AI', 'Bias Detection', 'Fairness'],
    [edge('ai-machine-learning', 'part_of')]),
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
  const result: Record<string, ConceptNode> = {};
  for (const s of SEED_CONCEPTS) {
    result[s.conceptId] = createConceptNode({
      ...s,
      lifecycle: 'stable',
    });
  }
  return result;
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
} {
  const domainSet = new Set(SEED_CONCEPTS.map(c => c.domain));
  const topics = SEED_CONCEPTS.filter(c => c.specificity === 'topic').length;
  const techniques = SEED_CONCEPTS.filter(c => c.specificity === 'technique').length;

  return {
    total: SEED_CONCEPTS.length,
    domains: domainSet.size,
    topics,
    techniques,
  };
}
