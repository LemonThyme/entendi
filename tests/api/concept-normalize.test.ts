import { describe, it, expect } from 'vitest';
import { normalizeConcept } from '../../src/api/lib/concept-normalize.js';

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
});
