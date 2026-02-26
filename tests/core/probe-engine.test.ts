import { describe, it, expect } from 'vitest';
import {
  buildProbePrompt,
  buildEvaluationPrompt,
  parseProbeResponse,
  parseEvaluationResponse,
} from '../../src/core/probe-engine.js';

describe('buildProbePrompt', () => {
  it('generates a prompt with concept and context', () => {
    const prompt = buildProbePrompt({
      conceptName: 'Redis',
      triggerContext: 'npm install redis',
      targetDepth: 0,
      previousResponses: [],
    });
    expect(prompt).toContain('Redis');
    expect(prompt).toContain('npm install redis');
  });

  it('includes previous responses for depth chaining', () => {
    const prompt = buildProbePrompt({
      conceptName: 'Redis',
      triggerContext: 'npm install redis',
      targetDepth: 1,
      previousResponses: [
        { question: 'Why Redis?', response: 'For caching', score: 2 },
      ],
    });
    expect(prompt).toContain('Why Redis?');
    expect(prompt).toContain('For caching');
  });
});

describe('buildEvaluationPrompt', () => {
  it('generates evaluation prompt with question and response', () => {
    const prompt = buildEvaluationPrompt({
      question: 'Why use Redis here?',
      response: 'For caching frequently accessed data',
      conceptName: 'Redis',
      depth: 0,
    });
    expect(prompt).toContain('Why use Redis here?');
    expect(prompt).toContain('For caching');
    expect(prompt).toContain('0');
    expect(prompt).toContain('1');
    expect(prompt).toContain('2');
    expect(prompt).toContain('3');
  });
});

describe('buildEvaluationPrompt adversarial hardening', () => {
  it('includes anti-gaming instructions', () => {
    const prompt = buildEvaluationPrompt({
      question: 'Why use Redis?',
      response: 'I understand this deeply',
      conceptName: 'redis',
      depth: 1,
    });
    expect(prompt).toContain('Ignore meta-commentary');
    expect(prompt).toContain('confident tone with no specifics');
  });

  it('includes concept-specific evaluation criteria when provided', () => {
    const prompt = buildEvaluationPrompt({
      question: 'Why use Redis?',
      response: 'For caching',
      conceptName: 'redis',
      depth: 1,
      evaluationCriteria: 'Must mention persistence tradeoffs or data structure choices',
    });
    expect(prompt).toContain('Must mention persistence tradeoffs');
  });
});

describe('parseProbeResponse', () => {
  it('extracts question from JSON response', () => {
    const result = parseProbeResponse('{"question": "Why use Redis?", "probeType": "why"}');
    expect(result.question).toBe('Why use Redis?');
    expect(result.probeType).toBe('why');
  });

  it('handles response wrapped in markdown code block', () => {
    const result = parseProbeResponse('```json\n{"question": "Why use Redis?", "probeType": "why"}\n```');
    expect(result.question).toBe('Why use Redis?');
  });

  it('returns fallback for unparseable response', () => {
    const result = parseProbeResponse('not json at all');
    expect(result.question).toBeTruthy();
    expect(result.probeType).toBe('why');
  });
});

describe('parseEvaluationResponse', () => {
  it('extracts rubric score and reasoning', () => {
    const result = parseEvaluationResponse(
      '{"rubricScore": 2, "confidence": 0.85, "reasoning": "Good explanation", "suggestFollowup": true, "misconceptionDetected": null}'
    );
    expect(result.rubricScore).toBe(2);
    expect(result.confidence).toBe(0.85);
    expect(result.suggestFollowup).toBe(true);
  });

  it('clamps score to 0-3 range', () => {
    const result = parseEvaluationResponse('{"rubricScore": 5, "confidence": 0.5, "reasoning": "test", "suggestFollowup": false, "misconceptionDetected": null}');
    expect(result.rubricScore).toBe(3);
  });

  it('returns low score for unparseable response', () => {
    const result = parseEvaluationResponse('garbage');
    expect(result.rubricScore).toBe(0);
    expect(result.confidence).toBeLessThan(0.5);
  });
});
