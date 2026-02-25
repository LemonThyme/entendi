import type { ProbeEvaluation, RubricScore } from '../schemas/types.js';

// --- Input types for prompt builders ---

export interface ProbePromptInput {
  conceptName: string;
  triggerContext: string;
  targetDepth: 0 | 1 | 2 | 3;
  previousResponses: Array<{ question: string; response: string; score: RubricScore }>;
}

export interface EvaluationPromptInput {
  question: string;
  response: string;
  conceptName: string;
  depth: 0 | 1 | 2 | 3;
}

// --- Parsed probe output ---

export interface ParsedProbe {
  question: string;
  probeType: 'why' | 'transfer' | 'failure' | 'counterfactual' | 'dependency' | 'context_bound';
}

// --- Prompt builders (pure functions) ---

const DEPTH_DESCRIPTIONS: Record<number, string> = {
  0: 'recall — Can the user name/define the concept?',
  1: 'comprehension — Can the user explain why/how it works?',
  2: 'application — Can the user apply it to a novel scenario?',
  3: 'evaluation — Can the user critique, compare, or evaluate trade-offs?',
};

const PROBE_TYPES = [
  'why — Ask why a choice was made or why something works the way it does',
  'transfer — Ask the user to apply the concept in a different context',
  'failure — Ask what would happen if something went wrong',
  'counterfactual — Ask what would change if a condition were different',
  'dependency — Ask about prerequisites or what this concept depends on',
  'context_bound — Ask about the specific context in which this concept is being used',
];

export function buildProbePrompt(input: ProbePromptInput): string {
  const { conceptName, triggerContext, targetDepth, previousResponses } = input;

  let prompt = `You are a Socratic comprehension probe generator. Your job is to create a single focused question that assesses whether a developer truly understands a concept they are using in their work.

## Concept
${conceptName}

## Trigger Context
The user was observed doing the following:
${triggerContext}

## Target Depth Level
${targetDepth} — ${DEPTH_DESCRIPTIONS[targetDepth]}

## Depth Level Reference
0: ${DEPTH_DESCRIPTIONS[0]}
1: ${DEPTH_DESCRIPTIONS[1]}
2: ${DEPTH_DESCRIPTIONS[2]}
3: ${DEPTH_DESCRIPTIONS[3]}

## Probe Types
Choose the most appropriate probe type for this depth level:
${PROBE_TYPES.map((t) => `- ${t}`).join('\n')}
`;

  if (previousResponses.length > 0) {
    prompt += `
## Previous Responses in This Probe Chain
The user has already answered earlier probes on this concept. Use their responses to calibrate the depth and focus of your question.
`;
    for (const prev of previousResponses) {
      prompt += `
Q: ${prev.question}
A: ${prev.response}
Score: ${prev.score}/3
`;
    }
  }

  prompt += `
## Output Format
Respond with a single JSON object (no markdown, no extra text):
{"question": "Your probe question here", "probeType": "why"}

The question should be concise (1-2 sentences), specific to the trigger context, and calibrated to depth level ${targetDepth}.`;

  return prompt;
}

export function buildEvaluationPrompt(input: EvaluationPromptInput): string {
  const { question, response, conceptName, depth } = input;

  return `You are an expert evaluator of conceptual understanding. Evaluate the following response to a comprehension probe about "${conceptName}".

## Probe Question
${question}

## User Response
${response}

## Depth Level
${depth} — ${DEPTH_DESCRIPTIONS[depth]}

## Rubric (0-3 scale)
Score the response using this rubric:
0 — No understanding: The response is wrong, irrelevant, or "I don't know"
1 — Surface/partial: The user shows vague awareness but cannot explain the concept correctly
2 — Functional: The user gives a correct and coherent explanation appropriate for depth level ${depth}
3 — Deep/transferable: The user demonstrates insight beyond what was asked — identifies trade-offs, edge cases, or connects to related concepts

## Evaluation Criteria
- Evaluate conceptual understanding only, not grammar or fluency
- A response can be informal/terse and still score 3 if it demonstrates deep understanding
- A response can be verbose and polished but score 0 if it shows no real understanding
- Consider the depth level: a recall-level (0) question requires less than an evaluation-level (3) question

## Output Format
Respond with a single JSON object (no markdown, no extra text):
{"rubricScore": 0, "confidence": 0.85, "reasoning": "Brief explanation of the score", "suggestFollowup": true, "misconceptionDetected": null}

- rubricScore: integer 0-3
- confidence: float 0-1 (how confident you are in this evaluation)
- reasoning: string (1-2 sentences explaining the score)
- suggestFollowup: boolean (should we probe deeper on this concept?)
- misconceptionDetected: string or null (describe any specific misconception found)`;
}

// --- Response parsers ---

function extractJsonFromMarkdown(raw: string): string {
  // Try to extract JSON from markdown code blocks
  const codeBlockMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim();
  }
  return raw.trim();
}

const VALID_PROBE_TYPES = new Set([
  'why',
  'transfer',
  'failure',
  'counterfactual',
  'dependency',
  'context_bound',
]);

export function parseProbeResponse(raw: string): ParsedProbe {
  const cleaned = extractJsonFromMarkdown(raw);

  try {
    const parsed = JSON.parse(cleaned);

    const question = typeof parsed.question === 'string' && parsed.question.length > 0
      ? parsed.question
      : 'Can you explain this concept in your own words?';

    const probeType = VALID_PROBE_TYPES.has(parsed.probeType)
      ? (parsed.probeType as ParsedProbe['probeType'])
      : 'why';

    return { question, probeType };
  } catch {
    // Fallback: try to extract a question from the raw text
    const questionMatch = raw.match(/["']?question["']?\s*:\s*["']([^"']+)["']/);
    const question = questionMatch
      ? questionMatch[1]
      : 'Can you explain this concept in your own words?';

    return { question, probeType: 'why' };
  }
}

export function parseEvaluationResponse(raw: string): ProbeEvaluation {
  const cleaned = extractJsonFromMarkdown(raw);

  try {
    const parsed = JSON.parse(cleaned);

    const rawScore = typeof parsed.rubricScore === 'number' ? parsed.rubricScore : 0;
    const rubricScore = Math.min(3, Math.max(0, Math.round(rawScore))) as RubricScore;

    const confidence = typeof parsed.confidence === 'number'
      ? Math.min(1, Math.max(0, parsed.confidence))
      : 0.5;

    const reasoning = typeof parsed.reasoning === 'string'
      ? parsed.reasoning
      : 'Unable to parse evaluation reasoning';

    const suggestFollowup = typeof parsed.suggestFollowup === 'boolean'
      ? parsed.suggestFollowup
      : true;

    const misconceptionDetected = typeof parsed.misconceptionDetected === 'string'
      ? parsed.misconceptionDetected
      : null;

    return { rubricScore, confidence, reasoning, suggestFollowup, misconceptionDetected };
  } catch {
    return {
      rubricScore: 0,
      confidence: 0.2,
      reasoning: 'Failed to parse evaluation response',
      suggestFollowup: true,
      misconceptionDetected: null,
    };
  }
}

// --- API functions (lazy-init Anthropic client) ---

let anthropicClient: InstanceType<typeof import('@anthropic-ai/sdk').default> | null = null;

const MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 300;

async function getClient(): Promise<InstanceType<typeof import('@anthropic-ai/sdk').default>> {
  if (!anthropicClient) {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    anthropicClient = new Anthropic();
  }
  return anthropicClient;
}

export async function generateProbe(input: ProbePromptInput): Promise<ParsedProbe> {
  const client = await getClient();
  const prompt = buildProbePrompt(input);

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    messages: [{ role: 'user', content: prompt }],
  });

  const textBlock = response.content.find((block) => block.type === 'text');
  const raw = textBlock ? textBlock.text : '';

  return parseProbeResponse(raw);
}

export async function evaluateResponse(input: EvaluationPromptInput): Promise<ProbeEvaluation> {
  const client = await getClient();
  const prompt = buildEvaluationPrompt(input);

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    messages: [{ role: 'user', content: prompt }],
  });

  const textBlock = response.content.find((block) => block.type === 'text');
  const raw = textBlock ? textBlock.text : '';

  return parseEvaluationResponse(raw);
}
