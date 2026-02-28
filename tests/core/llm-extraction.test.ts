import { describe, expect, it } from 'vitest';
import { buildConceptExtractionPrompt, parseConceptExtractionResponse } from '../../src/core/llm-extraction.js';

describe('LLM Concept Extraction', () => {
  describe('buildConceptExtractionPrompt', () => {
    it('builds a prompt with the interaction text', () => {
      const prompt = buildConceptExtractionPrompt('How do I implement a Redis cache with TTL?');
      expect(prompt).toContain('How do I implement a Redis cache with TTL?');
      expect(prompt).toContain('concepts');
      expect(prompt).toContain('JSON');
    });

    it('includes context when provided', () => {
      const prompt = buildConceptExtractionPrompt('Add caching', { fileContext: 'src/api/handler.ts', projectContext: 'express-app' });
      expect(prompt).toContain('src/api/handler.ts');
      expect(prompt).toContain('express-app');
    });
  });

  describe('parseConceptExtractionResponse', () => {
    it('parses valid JSON response', () => {
      const raw = JSON.stringify({
        concepts: [{ name: 'Redis', specificity: 'technique', domain: 'databases', signals: ['mentioned Redis'] }],
        primaryIntent: 'building',
        apparentFamiliarity: 'intermediate',
      });
      const result = parseConceptExtractionResponse(raw);
      expect(result.concepts).toHaveLength(1);
      expect(result.concepts[0].name).toBe('Redis');
      expect(result.primaryIntent).toBe('building');
    });

    it('parses JSON from markdown code block', () => {
      const raw = '```json\n{"concepts": [{"name": "React", "specificity": "topic", "domain": "frontend", "signals": []}], "primaryIntent": "building", "apparentFamiliarity": "intermediate"}\n```';
      const result = parseConceptExtractionResponse(raw);
      expect(result.concepts).toHaveLength(1);
    });

    it('returns empty for unparseable response', () => {
      const result = parseConceptExtractionResponse('not json');
      expect(result.concepts).toEqual([]);
      expect(result.primaryIntent).toBe('unknown');
    });

    it('sets extractionSignal to llm', () => {
      const raw = JSON.stringify({
        concepts: [{ name: 'Docker', specificity: 'topic', domain: 'devops', signals: [] }],
        primaryIntent: 'building',
        apparentFamiliarity: 'novice',
      });
      const result = parseConceptExtractionResponse(raw);
      expect(result.concepts[0].extractionSignal).toBe('llm');
      expect(result.concepts[0].confidence).toBeCloseTo(0.7);
    });
  });
});
