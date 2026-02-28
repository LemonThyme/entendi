import { beforeAll, describe, expect, it } from 'vitest';
import { extractConceptsFromSource, initParser } from '../../src/core/ast-extraction.js';

describe('AST Concept Extraction', () => {
  beforeAll(async () => {
    await initParser();
  });

  it('detects async/await', async () => {
    const source = `async function fetchData(url: string) { const r = await fetch(url); return r.json(); }`;
    const concepts = await extractConceptsFromSource(source, 'typescript');
    expect(concepts.map(c => c.name)).toContain('async-programming');
  });

  it('detects generics', async () => {
    const source = `function identity<T>(arg: T): T { return arg; }`;
    const concepts = await extractConceptsFromSource(source, 'typescript');
    expect(concepts.map(c => c.name)).toContain('generics');
  });

  it('detects try/catch', async () => {
    const source = `try { riskyOp(); } catch (e) { console.error(e); }`;
    const concepts = await extractConceptsFromSource(source, 'typescript');
    expect(concepts.map(c => c.name)).toContain('error-handling');
  });

  it('detects classes with inheritance (OOP)', async () => {
    const source = `class Animal { constructor(public name: string) {} } class Dog extends Animal { speak() { return 'Woof'; } }`;
    const concepts = await extractConceptsFromSource(source, 'typescript');
    expect(concepts.map(c => c.name)).toContain('oop');
  });

  it('detects destructuring', async () => {
    const source = `const { name, age } = person; const [first, ...rest] = items;`;
    const concepts = await extractConceptsFromSource(source, 'typescript');
    expect(concepts.map(c => c.name)).toContain('destructuring');
  });

  it('detects generators', async () => {
    const source = `function* range(s: number, e: number) { for (let i = s; i < e; i++) yield i; }`;
    const concepts = await extractConceptsFromSource(source, 'typescript');
    expect(concepts.map(c => c.name)).toContain('iterators-generators');
  });

  it('returns ExtractedConcept-compatible objects', async () => {
    const source = `async function f() { await Promise.resolve(); }`;
    const concepts = await extractConceptsFromSource(source, 'typescript');
    expect(concepts.length).toBeGreaterThan(0);
    for (const c of concepts) {
      expect(c.extractionSignal).toBe('ast');
      expect(c.confidence).toBeGreaterThan(0);
      expect(['domain', 'topic', 'technique']).toContain(c.specificity);
    }
  });

  it('returns empty array for empty source', async () => {
    expect(await extractConceptsFromSource('', 'typescript')).toEqual([]);
  });

  it('detects decorators', async () => {
    const source = `@Component({ selector: 'app-root' }) class AppComponent {}`;
    const concepts = await extractConceptsFromSource(source, 'typescript');
    expect(concepts.map(c => c.name)).toContain('decorators-metaprogramming');
  });

  it('deduplicates concepts by name', async () => {
    const source = `
      async function a() { await fetch('/a'); }
      async function b() { await fetch('/b'); }
    `;
    const concepts = await extractConceptsFromSource(source, 'typescript');
    const asyncConcepts = concepts.filter(c => c.name === 'async-programming');
    expect(asyncConcepts.length).toBe(1);
  });

  it('detects multiple concepts in one snippet', async () => {
    const source = `
      async function fetchData<T>(url: string): Promise<T> {
        try {
          const response = await fetch(url);
          const { data, error } = await response.json();
          if (error) throw new Error(error);
          return data as T;
        } catch (e) {
          console.error(e);
          throw e;
        }
      }
    `;
    const concepts = await extractConceptsFromSource(source, 'typescript');
    const names = concepts.map(c => c.name);
    expect(names).toContain('async-programming');
    expect(names).toContain('generics');
    expect(names).toContain('error-handling');
    expect(names).toContain('destructuring');
  });

  it('works with javascript language', async () => {
    const source = `async function fetchData(url) { const r = await fetch(url); return r.json(); }`;
    const concepts = await extractConceptsFromSource(source, 'javascript');
    expect(concepts.map(c => c.name)).toContain('async-programming');
  });

  it('works with python language', async () => {
    const source = `
async def fetch_data(url):
    response = await aiohttp.get(url)
    return response.json()
`;
    const concepts = await extractConceptsFromSource(source, 'python');
    expect(concepts.map(c => c.name)).toContain('async-programming');
  });

  it('returns empty array for unsupported language', async () => {
    const concepts = await extractConceptsFromSource('fn main() {}', 'rust' as any);
    expect(concepts).toEqual([]);
  });
});
