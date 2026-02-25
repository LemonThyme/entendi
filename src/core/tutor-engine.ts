// --- Input types for tutor prompt builders ---

export interface TutorExchangeInput {
  phase: string;
  question: string;
  response: string | null;
}

export interface ParsedTutorResponse {
  question: string;
  misconceptionDetected: string | null;
}

// --- Shared system instruction ---

const TUTOR_SYSTEM = `You are a Socratic tutor helping a developer deepen their understanding of a concept they encountered during AI-assisted coding. Your goal is to guide them toward genuine comprehension through dialogue, not to lecture.

Guidelines:
- Ask one focused question at a time
- Build on the learner's previous answers
- If you detect a misconception, note it but guide toward correction rather than stating the answer directly
- Keep questions concise (1-2 sentences)
- Respond with a single JSON object (no markdown, no extra text):
{"question": "Your question here", "misconceptionDetected": "description of misconception" | null}`;

// --- Prompt builders (pure functions) ---

export function buildPhase1Prompt(input: { conceptName: string; triggerContext: string }): string {
  const { conceptName, triggerContext } = input;

  return `${TUTOR_SYSTEM}

## Phase: Review (Phase 1)
Assess what the learner already knows about this concept before guided discovery begins.

## Concept
${conceptName}

## Trigger Context
The learner was observed doing the following:
${triggerContext}

## Instructions
Ask the learner what they already know about ${conceptName}. The question should be open-ended and invite them to share their existing understanding. This is a diagnostic question to establish a baseline.

## Output Format
Respond with a single JSON object:
{"question": "What do you already know about ...?", "misconceptionDetected": null}`;
}

export function buildPhase2Prompt(input: { conceptName: string; exchanges: TutorExchangeInput[] }): string {
  const { conceptName, exchanges } = input;

  let prompt = `${TUTOR_SYSTEM}

## Phase: Guided Discovery (Phase 2)
Based on the learner's Phase 1 response, push them toward deeper understanding through guided discovery. Identify gaps or shallow areas in their knowledge and ask a question that helps them discover the deeper principle themselves.

## Concept
${conceptName}

## Conversation So Far
`;

  for (const ex of exchanges) {
    prompt += `[${ex.phase}] Q: ${ex.question}\n`;
    if (ex.response !== null) {
      prompt += `[${ex.phase}] A: ${ex.response}\n`;
    }
  }

  prompt += `
## Instructions
Based on the learner's answers so far, identify the most important gap or shallow area in their understanding. Ask a question that guides them toward discovering a deeper principle or connection. Do not lecture; lead them to the insight through questioning.

## Output Format
Respond with a single JSON object:
{"question": "...", "misconceptionDetected": "..." | null}`;

  return prompt;
}

export function buildPhase3Prompt(input: { conceptName: string; exchanges: TutorExchangeInput[]; misconception?: string }): string {
  const { conceptName, exchanges, misconception } = input;

  let prompt = `${TUTOR_SYSTEM}

## Phase: Rectification (Phase 3)
`;

  if (misconception) {
    prompt += `A misconception has been detected: "${misconception}"
Correct this misconception through Socratic questioning. Do not state the correct answer directly; instead, ask a question that exposes the flaw in the learner's reasoning and guides them toward the correct understanding.

`;
  } else {
    prompt += `No specific misconception was detected. Deepen the learner's understanding further by probing an area they haven't fully explored yet.

`;
  }

  prompt += `## Concept
${conceptName}

## Conversation So Far
`;

  for (const ex of exchanges) {
    prompt += `[${ex.phase}] Q: ${ex.question}\n`;
    if (ex.response !== null) {
      prompt += `[${ex.phase}] A: ${ex.response}\n`;
    }
  }

  prompt += `
## Instructions
`;

  if (misconception) {
    prompt += `The learner holds this misconception: "${misconception}". Ask a question that helps them see why this belief is incorrect. Use a counterexample, edge case, or consequence of their incorrect reasoning to guide them toward rectification.`;
  } else {
    prompt += `Push the learner to explore a deeper aspect of ${conceptName} that they haven't addressed yet. Ask about trade-offs, edge cases, or connections to related concepts.`;
  }

  prompt += `

## Output Format
Respond with a single JSON object:
{"question": "...", "misconceptionDetected": "..." | null}`;

  return prompt;
}

export function buildPhase4Prompt(input: { conceptName: string; exchanges: TutorExchangeInput[] }): string {
  const { conceptName, exchanges } = input;

  let prompt = `${TUTOR_SYSTEM}

## Phase: Consolidation (Phase 4)
This is the final phase. Ask the learner to explain the full picture of what they now understand. This is a summative assessment question.

## Concept
${conceptName}

## Conversation So Far
`;

  for (const ex of exchanges) {
    prompt += `[${ex.phase}] Q: ${ex.question}\n`;
    if (ex.response !== null) {
      prompt += `[${ex.phase}] A: ${ex.response}\n`;
    }
  }

  prompt += `
## Instructions
Ask the learner to explain the full picture of ${conceptName} in their own words, integrating what they've learned through this dialogue. The question should invite a comprehensive explanation that demonstrates consolidated understanding.

## Output Format
Respond with a single JSON object:
{"question": "Can you now explain the full picture of ...?", "misconceptionDetected": null}`;

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

export function parseTutorResponse(raw: string): ParsedTutorResponse {
  const cleaned = extractJsonFromMarkdown(raw);

  try {
    const parsed = JSON.parse(cleaned);

    const question = typeof parsed.question === 'string' && parsed.question.length > 0
      ? parsed.question
      : 'Can you explain this concept in your own words?';

    const misconceptionDetected = typeof parsed.misconceptionDetected === 'string'
      ? parsed.misconceptionDetected
      : null;

    return { question, misconceptionDetected };
  } catch {
    // Fallback: try to extract a question from the raw text
    const questionMatch = raw.match(/["']?question["']?\s*:\s*["']([^"']+)["']/);
    const question = questionMatch
      ? questionMatch[1]
      : 'Can you explain this concept in your own words?';

    return { question, misconceptionDetected: null };
  }
}

// --- API function (lazy-init Anthropic client) ---

let anthropicClient: InstanceType<typeof import('@anthropic-ai/sdk').default> | null = null;

const MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 400;

async function getClient(): Promise<InstanceType<typeof import('@anthropic-ai/sdk').default>> {
  if (!anthropicClient) {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    anthropicClient = new Anthropic();
  }
  return anthropicClient;
}

export async function generateTutorQuestion(prompt: string): Promise<ParsedTutorResponse> {
  const client = await getClient();

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    messages: [{ role: 'user', content: prompt }],
  });

  const textBlock = response.content.find((block) => block.type === 'text');
  const raw = textBlock ? textBlock.text : '';

  return parseTutorResponse(raw);
}
