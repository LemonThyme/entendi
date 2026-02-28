import { describe, expect, it } from 'vitest';
import { normalizeConcept, resolveConceptId } from '../../src/api/lib/concept-normalize.js';

describe('normalizeConcept', () => {
  it('lowercases', () => {
    expect(normalizeConcept('React-Hooks')).toBe('react-hooks');
  });

  it('replaces / . _ spaces with -', () => {
    expect(normalizeConcept('A/B Testing')).toBe('a-b-testing');
    expect(normalizeConcept('React.js')).toBe('react-js');
    expect(normalizeConcept('ci_cd_pipeline')).toBe('ci-cd-pipeline');
    expect(normalizeConcept('thompson sampling')).toBe('thompson-sampling');
  });

  it('collapses consecutive dashes', () => {
    expect(normalizeConcept('a--b---c')).toBe('a-b-c');
  });

  it('strips leading/trailing dashes', () => {
    expect(normalizeConcept('-react-hooks-')).toBe('react-hooks');
  });

  it('truncates to 200 chars', () => {
    const long = 'a'.repeat(250);
    expect(normalizeConcept(long).length).toBe(200);
  });

  it('handles already-normalized input', () => {
    expect(normalizeConcept('thompson-sampling')).toBe('thompson-sampling');
  });

  it('handles mixed separators', () => {
    expect(normalizeConcept('CI/CD_Pipeline Setup')).toBe('ci-cd-pipeline-setup');
  });

  it('handles empty-ish input', () => {
    expect(normalizeConcept('---')).toBe('');
    expect(normalizeConcept('  ')).toBe('');
  });

  it('handles dotted names (e.g. React.Component)', () => {
    expect(normalizeConcept('React.Component')).toBe('react-component');
    expect(normalizeConcept('fs.readFileSync')).toBe('fs-readfilesync');
  });

  it('handles path-like concepts', () => {
    expect(normalizeConcept('src/api/routes')).toBe('src-api-routes');
  });

  it('normalizes multiple variant forms to same canonical ID', () => {
    const variants = [
      'A/B Testing',
      'a/b testing',
      'A/B_Testing',
      'a-b-testing',
      'A.B.Testing',
    ];
    const normalized = variants.map(normalizeConcept);
    expect(new Set(normalized).size).toBe(1);
    expect(normalized[0]).toBe('a-b-testing');
  });
});

describe('resolveConceptId', () => {
  it('returns canonical ID if alias exists', async () => {
    const mockDb = {
      select: () => ({
        from: () => ({
          where: () => [{ canonicalId: 'a-b-testing' }],
        }),
      }),
    };
    const result = await resolveConceptId(mockDb as any, 'ab-testing');
    expect(result).toBe('a-b-testing');
  });

  it('returns normalized input if no alias exists', async () => {
    const mockDb = {
      select: () => ({
        from: () => ({
          where: () => [],
        }),
      }),
    };
    const result = await resolveConceptId(mockDb as any, 'Thompson Sampling');
    expect(result).toBe('thompson-sampling');
  });

  it('normalizes before looking up alias', async () => {
    const mockDb = {
      select: () => ({
        from: () => ({
          where: () => [{ canonicalId: 'react-hooks' }],
        }),
      }),
    };
    // Input with mixed case and spaces should be normalized before alias lookup
    const result = await resolveConceptId(mockDb as any, 'React Hooks');
    expect(result).toBe('react-hooks');
  });
});
