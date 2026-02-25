import type { ExtractedConcept, ConceptSpecificity } from '../schemas/types.js';

// --- Types ---

export interface LLMExtractedConcept extends ExtractedConcept {
  domain: string;
  signals: string[];
}

export interface LLMExtractedConcepts {
  concepts: LLMExtractedConcept[];
  primaryIntent: string;
  apparentFamiliarity: string;
}

export interface ExtractionContext {
  fileContext?: string | null;
  projectContext?: string | null;
}

// --- Prompt builder ---

export function buildConceptExtractionPrompt(text: string, context?: ExtractionContext): string {
  let prompt = `You are a concept extraction engine for a developer comprehension tracking system. Analyze the following interaction text and extract the technical concepts being used or discussed.

## Interaction Text
${text}
`;

  if (context?.fileContext || context?.projectContext) {
    prompt += `
## Context`;
    if (context.fileContext) {
      prompt += `
File: ${context.fileContext}`;
    }
    if (context.projectContext) {
      prompt += `
Project: ${context.projectContext}`;
    }
    prompt += '\n';
  }

  prompt += `
## Instructions
Extract all technical concepts from the interaction text. For each concept, provide:
- **name**: kebab-case identifier (e.g., "redis-caching", "react-hooks")
- **specificity**: one of "domain", "topic", or "technique"
- **domain**: the technical domain (e.g., "databases", "frontend", "devops")
- **signals**: array of evidence strings from the text that indicate this concept

Also determine:
- **primaryIntent**: what the user is trying to do (e.g., "building", "debugging", "learning", "refactoring")
- **apparentFamiliarity**: the user's apparent familiarity level ("novice", "intermediate", "expert")

## Output Format
Respond with a single JSON object (no markdown, no extra text):
{"concepts": [{"name": "concept-name", "specificity": "technique", "domain": "databases", "signals": ["evidence from text"]}], "primaryIntent": "building", "apparentFamiliarity": "intermediate"}`;

  return prompt;
}

// --- Response parser ---

function extractJsonFromMarkdown(raw: string): string {
  const codeBlockMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim();
  }
  return raw.trim();
}

const VALID_SPECIFICITIES = new Set<string>(['domain', 'topic', 'technique']);

export function parseConceptExtractionResponse(raw: string): LLMExtractedConcepts {
  const cleaned = extractJsonFromMarkdown(raw);

  try {
    const parsed = JSON.parse(cleaned);

    if (!Array.isArray(parsed.concepts)) {
      return { concepts: [], primaryIntent: 'unknown', apparentFamiliarity: 'unknown' };
    }

    const concepts: LLMExtractedConcept[] = parsed.concepts
      .filter((c: Record<string, unknown>) =>
        typeof c.name === 'string' &&
        c.name.length > 0 &&
        typeof c.specificity === 'string' &&
        typeof c.domain === 'string'
      )
      .map((c: Record<string, unknown>): LLMExtractedConcept => ({
        name: c.name as string,
        specificity: (VALID_SPECIFICITIES.has(c.specificity as string)
          ? c.specificity
          : 'topic') as ConceptSpecificity,
        domain: c.domain as string,
        signals: Array.isArray(c.signals) ? (c.signals as string[]) : [],
        confidence: 0.7,
        extractionSignal: 'llm' as const,
      }));

    const primaryIntent = typeof parsed.primaryIntent === 'string'
      ? parsed.primaryIntent
      : 'unknown';

    const apparentFamiliarity = typeof parsed.apparentFamiliarity === 'string'
      ? parsed.apparentFamiliarity
      : 'unknown';

    return { concepts, primaryIntent, apparentFamiliarity };
  } catch {
    return { concepts: [], primaryIntent: 'unknown', apparentFamiliarity: 'unknown' };
  }
}

// --- API function (lazy-init Anthropic client) ---

let anthropicClient: InstanceType<typeof import('@anthropic-ai/sdk').default> | null = null;

const MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 500;

async function getClient(): Promise<InstanceType<typeof import('@anthropic-ai/sdk').default>> {
  if (!anthropicClient) {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    anthropicClient = new Anthropic();
  }
  return anthropicClient;
}

export async function extractConceptsViaLLM(
  text: string,
  context?: ExtractionContext,
): Promise<LLMExtractedConcepts> {
  const client = await getClient();
  const prompt = buildConceptExtractionPrompt(text, context);

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    messages: [{ role: 'user', content: prompt }],
  });

  const textBlock = response.content.find((block) => block.type === 'text');
  const raw = textBlock ? textBlock.text : '';

  return parseConceptExtractionResponse(raw);
}
