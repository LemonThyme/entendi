// src/core/response-integrity.ts

export interface ResponseFeatures {
  wordCount: number;
  charCount: number;
  avgWordLength: number;
  formattingScore: number;
  vocabularyComplexity: number;
  responseTimeMs: number;
  charsPerSecond: number;
}

export interface UserResponseProfile {
  avgWordCount: number;
  avgCharCount: number;
  avgCharsPerSecond: number;
  avgFormattingScore: number;
  avgVocabComplexity: number;
  sampleCount: number;
}

export interface IntegrityResult {
  score: number;
  flags: string[];
  features: ResponseFeatures;
}

export function extractResponseFeatures(text: string, responseTimeMs: number): ResponseFeatures {
  const trimmed = text.trim();
  const charCount = trimmed.length;
  const words = trimmed.split(/\s+/).filter(w => w.length > 0);
  const wordCount = words.length;
  const avgWordLength = wordCount > 0
    ? words.reduce((sum, w) => sum + w.length, 0) / wordCount
    : 0;

  // Formatting: markdown indicators unlikely in natural chat responses
  let formattingScore = 0;
  formattingScore += (trimmed.match(/\*\*[^*]+\*\*/g) || []).length;   // bold
  formattingScore += (trimmed.match(/^- /gm) || []).length;            // bullets
  formattingScore += (trimmed.match(/^\* /gm) || []).length;           // alt bullets
  formattingScore += (trimmed.match(/^#{1,6} /gm) || []).length;       // headers
  formattingScore += (trimmed.match(/^\d+\. /gm) || []).length;        // numbered lists
  formattingScore += (trimmed.match(/\u2022/g) || []).length;          // bullet char •
  formattingScore += (trimmed.match(/\.\.\./g) || []).length;          // ellipsis patterns

  // Vocabulary complexity: ratio of long words (>8 chars)
  const longWords = words.filter(w => w.replace(/[^a-zA-Z]/g, '').length > 8);
  const vocabularyComplexity = wordCount > 0 ? longWords.length / wordCount : 0;

  const responseTimeSec = responseTimeMs / 1000;
  const charsPerSecond = responseTimeSec > 0 ? charCount / responseTimeSec : 0;

  return {
    wordCount,
    charCount,
    avgWordLength,
    formattingScore,
    vocabularyComplexity,
    responseTimeMs,
    charsPerSecond,
  };
}

export function computeIntegrityScore(
  features: ResponseFeatures,
  baseline?: UserResponseProfile,
): IntegrityResult {
  const flags: string[] = [];
  let score = 1.0;

  // Typing speed anomaly: human typing is ~5-8 chars/sec
  if (features.charsPerSecond > 15) {
    flags.push('typing_speed_anomaly');
    // Scale penalty: 15 cps = mild, 50+ cps = severe
    const penalty = Math.min(0.6, (features.charsPerSecond - 15) / 50);
    score *= (1 - penalty);
  }

  // Excessive markdown formatting in chat
  if (features.formattingScore > 3) {
    flags.push('excessive_formatting');
    const penalty = Math.min(0.4, (features.formattingScore - 3) * 0.1);
    score *= (1 - penalty);
  }

  // Excessive length for a probe response
  if (features.wordCount > 150) {
    flags.push('excessive_length');
    const penalty = Math.min(0.3, (features.wordCount - 150) / 500);
    score *= (1 - penalty);
  }

  // Style drift from user baseline
  if (baseline && baseline.sampleCount >= 3) {
    let driftSignals = 0;
    let driftCount = 0;

    // Word count drift
    if (baseline.avgWordCount > 0) {
      const ratio = features.wordCount / baseline.avgWordCount;
      if (ratio > 3) { driftSignals++; }
      driftCount++;
    }

    // Chars per second drift
    if (baseline.avgCharsPerSecond > 0) {
      const ratio = features.charsPerSecond / baseline.avgCharsPerSecond;
      if (ratio > 2.5) { driftSignals++; }
      driftCount++;
    }

    // Formatting drift
    if (baseline.avgFormattingScore >= 0) {
      const diff = features.formattingScore - baseline.avgFormattingScore;
      if (diff > 3) { driftSignals++; }
      driftCount++;
    }

    if (driftCount > 0 && driftSignals >= 2) {
      flags.push('style_drift');
      score *= 0.7;
    }
  }

  score = Math.max(0, Math.min(1, score));

  return { score, flags, features };
}

const EMA_ALPHA = 0.3;

export function updateResponseProfile(
  existing: UserResponseProfile | null,
  features: ResponseFeatures,
): UserResponseProfile {
  if (!existing || existing.sampleCount === 0) {
    return {
      avgWordCount: features.wordCount,
      avgCharCount: features.charCount,
      avgCharsPerSecond: features.charsPerSecond,
      avgFormattingScore: features.formattingScore,
      avgVocabComplexity: features.vocabularyComplexity,
      sampleCount: 1,
    };
  }

  return {
    avgWordCount: EMA_ALPHA * features.wordCount + (1 - EMA_ALPHA) * existing.avgWordCount,
    avgCharCount: EMA_ALPHA * features.charCount + (1 - EMA_ALPHA) * existing.avgCharCount,
    avgCharsPerSecond: EMA_ALPHA * features.charsPerSecond + (1 - EMA_ALPHA) * existing.avgCharsPerSecond,
    avgFormattingScore: EMA_ALPHA * features.formattingScore + (1 - EMA_ALPHA) * existing.avgFormattingScore,
    avgVocabComplexity: EMA_ALPHA * features.vocabularyComplexity + (1 - EMA_ALPHA) * existing.avgVocabComplexity,
    sampleCount: existing.sampleCount + 1,
  };
}
