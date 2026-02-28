import { describe, expect, it, vi } from 'vitest';
import { embedConcept } from '../../src/api/lib/embeddings.js';

describe('embedConcept', () => {
  it('returns null when AI binding is not available', async () => {
    const result = await embedConcept(null, 'thompson-sampling');
    expect(result).toBeNull();
  });

  it('returns null when AI binding is undefined', async () => {
    const result = await embedConcept(undefined, 'react-hooks');
    expect(result).toBeNull();
  });

  it('returns embedding array from Workers AI', async () => {
    const mockAi = {
      run: vi.fn().mockResolvedValue({ data: [new Array(768).fill(0.1)] }),
    };
    const result = await embedConcept(mockAi, 'thompson-sampling');
    expect(result).toHaveLength(768);
    expect(mockAi.run).toHaveBeenCalledWith('@cf/baai/bge-base-en-v1.5', {
      text: ['thompson sampling'],
    });
  });

  it('converts kebab-case to spaces for embedding input', async () => {
    const mockAi = {
      run: vi.fn().mockResolvedValue({ data: [new Array(768).fill(0.2)] }),
    };
    await embedConcept(mockAi, 'ci-cd-pipeline');
    expect(mockAi.run).toHaveBeenCalledWith('@cf/baai/bge-base-en-v1.5', {
      text: ['ci cd pipeline'],
    });
  });

  it('returns null when Workers AI throws', async () => {
    const mockAi = {
      run: vi.fn().mockRejectedValue(new Error('Workers AI unavailable')),
    };
    const result = await embedConcept(mockAi, 'react-hooks');
    expect(result).toBeNull();
  });

  it('returns null when Workers AI returns unexpected shape', async () => {
    const mockAi = {
      run: vi.fn().mockResolvedValue({}),
    };
    const result = await embedConcept(mockAi, 'react-hooks');
    expect(result).toBeNull();
  });
});
