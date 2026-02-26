// tests/core/response-integrity.test.ts
import { describe, it, expect } from 'vitest';
import {
  extractResponseFeatures,
  computeIntegrityScore,
  updateResponseProfile,
  type UserResponseProfile,
} from '../../src/core/response-integrity.js';

describe('extractResponseFeatures', () => {
  it('extracts basic text features', () => {
    const features = extractResponseFeatures('hello world foo bar', 10000);
    expect(features.wordCount).toBe(4);
    expect(features.charCount).toBe(19);
    expect(features.avgWordLength).toBeCloseTo(4.0);
    expect(features.formattingScore).toBe(0);
    expect(features.responseTimeMs).toBe(10000);
    expect(features.charsPerSecond).toBeCloseTo(1.9);
  });

  it('detects markdown formatting', () => {
    const text = `**Bold text** and more **bold**
- bullet one
- bullet two
# Header
1. numbered
2. list`;
    const features = extractResponseFeatures(text, 5000);
    // 2 bold + 2 bullets + 1 header + 2 numbered = 7
    expect(features.formattingScore).toBe(7);
  });

  it('computes vocabulary complexity', () => {
    // Words >8 chars: "understanding", "comprehensive", "sophisticated"
    const text = 'a comprehensive understanding of sophisticated systems';
    const features = extractResponseFeatures(text, 5000);
    expect(features.vocabularyComplexity).toBeCloseTo(3 / 6); // 3 long words out of 6
  });

  it('handles empty text', () => {
    const features = extractResponseFeatures('', 5000);
    expect(features.wordCount).toBe(0);
    expect(features.charCount).toBe(0);
    expect(features.avgWordLength).toBe(0);
    expect(features.charsPerSecond).toBe(0);
  });

  it('computes chars per second from response time', () => {
    const features = extractResponseFeatures('hello world', 2000); // 2 seconds
    expect(features.charsPerSecond).toBeCloseTo(5.5); // 11 chars / 2 sec
  });

  it('handles zero response time', () => {
    const features = extractResponseFeatures('hello', 0);
    expect(features.charsPerSecond).toBe(0);
  });
});

describe('computeIntegrityScore', () => {
  it('returns 1.0 for normal short responses', () => {
    const features = extractResponseFeatures('I think it uses Bayesian updating', 15000);
    const result = computeIntegrityScore(features);
    expect(result.score).toBeCloseTo(1.0);
    expect(result.flags).toHaveLength(0);
  });

  it('flags typing speed anomaly', () => {
    // 200 chars in 2 seconds = 100 cps (way too fast)
    const text = 'a'.repeat(200);
    const features = extractResponseFeatures(text, 2000);
    const result = computeIntegrityScore(features);
    expect(result.flags).toContain('typing_speed_anomaly');
    expect(result.score).toBeLessThan(1.0);
  });

  it('flags excessive formatting', () => {
    const text = `**Key points:**
- First concept
- Second concept
- Third concept
# Summary
1. Detail one`;
    const features = extractResponseFeatures(text, 30000);
    const result = computeIntegrityScore(features);
    expect(result.flags).toContain('excessive_formatting');
    expect(result.score).toBeLessThan(1.0);
  });

  it('flags excessive length', () => {
    const words = Array(200).fill('word').join(' ');
    const features = extractResponseFeatures(words, 120000); // 2 min, reasonable pace
    const result = computeIntegrityScore(features);
    expect(result.flags).toContain('excessive_length');
    expect(result.score).toBeLessThan(1.0);
  });

  it('detects style drift from baseline', () => {
    const baseline: UserResponseProfile = {
      avgWordCount: 15,
      avgCharCount: 80,
      avgCharsPerSecond: 4,
      avgFormattingScore: 0,
      avgVocabComplexity: 0.1,
      sampleCount: 10,
    };

    // Response with 3x the word count and 2.5x chars/sec
    const text = Array(50).fill('word').join(' ');
    const features = extractResponseFeatures(text, 10000); // ~25 cps
    const result = computeIntegrityScore(features, baseline);
    expect(result.flags).toContain('style_drift');
    expect(result.score).toBeLessThan(1.0);
  });

  it('does not flag style drift with insufficient baseline', () => {
    const baseline: UserResponseProfile = {
      avgWordCount: 15,
      avgCharCount: 80,
      avgCharsPerSecond: 4,
      avgFormattingScore: 0,
      avgVocabComplexity: 0.1,
      sampleCount: 2, // too few samples
    };

    const text = Array(50).fill('word').join(' ');
    const features = extractResponseFeatures(text, 10000);
    const result = computeIntegrityScore(features, baseline);
    expect(result.flags).not.toContain('style_drift');
  });

  it('combines multiple flags', () => {
    // Fast typing + heavy formatting + long
    const lines = Array(40).fill('- **important** point about something');
    const text = lines.join('\n');
    const features = extractResponseFeatures(text, 3000); // very fast
    const result = computeIntegrityScore(features);
    expect(result.flags.length).toBeGreaterThanOrEqual(2);
    expect(result.score).toBeLessThan(0.5);
  });

  it('score stays in [0, 1] range', () => {
    // Extremely suspicious
    const text = Array(300).fill('- **word**').join('\n');
    const features = extractResponseFeatures(text, 500);
    const result = computeIntegrityScore(features);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(1);
  });
});

describe('updateResponseProfile', () => {
  it('initializes profile from first response', () => {
    const features = extractResponseFeatures('hello world test', 5000);
    const profile = updateResponseProfile(null, features);
    expect(profile.sampleCount).toBe(1);
    expect(profile.avgWordCount).toBe(features.wordCount);
    expect(profile.avgCharCount).toBe(features.charCount);
    expect(profile.avgCharsPerSecond).toBe(features.charsPerSecond);
  });

  it('applies EMA to existing profile', () => {
    const existing: UserResponseProfile = {
      avgWordCount: 20,
      avgCharCount: 100,
      avgCharsPerSecond: 5,
      avgFormattingScore: 0,
      avgVocabComplexity: 0.1,
      sampleCount: 5,
    };

    const features = extractResponseFeatures('short', 2000);
    const updated = updateResponseProfile(existing, features);

    // EMA: new = 0.3 * current + 0.7 * existing
    expect(updated.avgWordCount).toBeCloseTo(0.3 * 1 + 0.7 * 20);
    expect(updated.sampleCount).toBe(6);
  });

  it('handles zero sample count as initialization', () => {
    const existing: UserResponseProfile = {
      avgWordCount: 0,
      avgCharCount: 0,
      avgCharsPerSecond: 0,
      avgFormattingScore: 0,
      avgVocabComplexity: 0,
      sampleCount: 0,
    };

    const features = extractResponseFeatures('test words here', 3000);
    const updated = updateResponseProfile(existing, features);
    expect(updated.sampleCount).toBe(1);
    expect(updated.avgWordCount).toBe(features.wordCount);
  });
});
