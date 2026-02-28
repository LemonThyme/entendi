import { describe, expect, it } from 'vitest';
import {
  buildPhase1Prompt,
  buildPhase2Prompt,
  buildPhase3Prompt,
  buildPhase4Prompt,
  parseTutorResponse,
} from '../../src/core/tutor-engine.js';

describe('buildPhase1Prompt', () => {
  it('contains concept name, "already know", and "JSON"', () => {
    const prompt = buildPhase1Prompt({
      conceptName: 'Redis pub/sub',
      triggerContext: 'npm install redis',
    });
    expect(prompt).toContain('Redis pub/sub');
    expect(prompt.toLowerCase()).toContain('already know');
    expect(prompt).toContain('JSON');
  });
});

describe('buildPhase2Prompt', () => {
  it('includes Phase 1 response text and "guided discovery"', () => {
    const prompt = buildPhase2Prompt({
      conceptName: 'Redis pub/sub',
      exchanges: [
        {
          phase: 'phase1',
          question: 'What do you already know about Redis pub/sub?',
          response: 'It lets you broadcast messages to multiple subscribers',
        },
      ],
    });
    expect(prompt).toContain('It lets you broadcast messages to multiple subscribers');
    expect(prompt.toLowerCase()).toContain('guided discovery');
  });
});

describe('buildPhase3Prompt', () => {
  it('includes misconception text when provided', () => {
    const prompt = buildPhase3Prompt({
      conceptName: 'Redis pub/sub',
      exchanges: [
        {
          phase: 'phase1',
          question: 'What do you know about Redis pub/sub?',
          response: 'It guarantees message delivery',
        },
      ],
      misconception: 'Redis pub/sub does not guarantee delivery; messages are fire-and-forget',
    });
    expect(prompt).toContain('Redis pub/sub does not guarantee delivery; messages are fire-and-forget');
  });

  it('omits misconception text when not provided', () => {
    const prompt = buildPhase3Prompt({
      conceptName: 'Redis pub/sub',
      exchanges: [
        {
          phase: 'phase1',
          question: 'What do you know about Redis pub/sub?',
          response: 'It lets publishers send messages to channels',
        },
      ],
    });
    expect(prompt).not.toContain('misconception has been detected');
    expect(prompt.toLowerCase()).toContain('deepen');
  });
});

describe('buildPhase4Prompt', () => {
  it('references "full picture" and "JSON"', () => {
    const prompt = buildPhase4Prompt({
      conceptName: 'Redis pub/sub',
      exchanges: [
        {
          phase: 'phase1',
          question: 'What do you know about Redis pub/sub?',
          response: 'Message broadcasting system',
        },
        {
          phase: 'phase2',
          question: 'What happens if a subscriber disconnects?',
          response: 'Messages are lost since pub/sub is fire-and-forget',
        },
      ],
    });
    expect(prompt.toLowerCase()).toContain('full picture');
    expect(prompt).toContain('JSON');
  });
});

describe('parseTutorResponse', () => {
  it('parses valid JSON', () => {
    const result = parseTutorResponse(
      '{"question": "What do you know about Redis?", "misconceptionDetected": null}'
    );
    expect(result.question).toBe('What do you know about Redis?');
    expect(result.misconceptionDetected).toBeNull();
  });

  it('extracts from markdown code blocks', () => {
    const result = parseTutorResponse(
      '```json\n{"question": "Why is pub/sub fire-and-forget?", "misconceptionDetected": null}\n```'
    );
    expect(result.question).toBe('Why is pub/sub fire-and-forget?');
    expect(result.misconceptionDetected).toBeNull();
  });

  it('returns fallback on invalid JSON', () => {
    const result = parseTutorResponse('this is not json at all');
    expect(result.question).toBeTruthy();
    expect(result.misconceptionDetected).toBeNull();
  });

  it('extracts misconceptionDetected when present', () => {
    const result = parseTutorResponse(
      '{"question": "Are you sure Redis guarantees delivery?", "misconceptionDetected": "Believes Redis pub/sub guarantees message delivery"}'
    );
    expect(result.question).toBe('Are you sure Redis guarantees delivery?');
    expect(result.misconceptionDetected).toBe('Believes Redis pub/sub guarantees message delivery');
  });
});
