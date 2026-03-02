#!/usr/bin/env node

// src/hooks/user-prompt-submit.ts
import { readFileSync as readFileSync2, unlinkSync, writeFileSync as writeFileSync2 } from "fs";
import { join as join3 } from "path";
import { homedir as homedir3 } from "os";

// src/shared/config.ts
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
var CONFIG_DIR = join(homedir(), ".entendi");
var CONFIG_FILE = join(CONFIG_DIR, "config.json");
function loadConfig() {
  let fileConfig = {};
  try {
    fileConfig = JSON.parse(readFileSync(CONFIG_FILE, "utf-8"));
  } catch {
  }
  return {
    apiUrl: process.env.ENTENDI_API_URL || fileConfig.apiUrl || "https://api.entendi.dev",
    // Config file takes priority — it's written by entendi_login (canonical auth flow).
    // Env var is a fallback for manual setup or CI.
    apiKey: fileConfig.apiKey || process.env.ENTENDI_API_KEY || void 0
  };
}

// src/hooks/shared.ts
import { appendFileSync, mkdirSync as mkdirSync2 } from "fs";
import { homedir as homedir2 } from "os";
import { join as join2 } from "path";
async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf-8");
}
var LOG_DIR = join2(homedir2(), ".entendi");
var LOG_FILE = join2(LOG_DIR, "debug.log");
var logDirCreated = false;
function log(component, message, data) {
  if (!logDirCreated) {
    try {
      mkdirSync2(LOG_DIR, { recursive: true });
    } catch {
    }
    logDirCreated = true;
  }
  const ts = (/* @__PURE__ */ new Date()).toISOString();
  const dataStr = data !== void 0 ? ` ${JSON.stringify(data)}` : "";
  try {
    appendFileSync(LOG_FILE, `[${ts}] [${component}] ${message}${dataStr}
`);
  } catch {
  }
}

// src/hooks/user-prompt-submit.ts
var LOGIN_PATTERNS = [
  /entendi\s+log\s*in/i,
  /entendi\s+login/i,
  /log\s*in\s+(?:to\s+)?entendi/i,
  /link\s+(?:my\s+)?(?:entendi\s+)?account/i,
  /entendi\s+auth/i
];
function detectLoginPattern(prompt) {
  return LOGIN_PATTERNS.some((p) => p.test(prompt));
}
var TEACH_ME_PATTERNS = [
  /teach\s+me\s+(?:about\s+)?(.+)/i,
  /explain\s+(.+?)(?:\s+to\s+me)?$/i,
  /help\s+me\s+understand\s+(.+)/i
];
function detectTeachMePattern(prompt) {
  for (const pattern of TEACH_ME_PATTERNS) {
    const match = prompt.match(pattern);
    if (!match) continue;
    const extractedName = match[1].trim().replace(/[?.!]+$/, "").trim();
    if (extractedName) return extractedName;
  }
  return null;
}
var CONCEPT_KEYWORDS = {
  "environment-variables": ["env var", "environment variable", ".env", "process.env", "dotenv", "secrets", "config var"],
  "deployment": ["deploy", "production", "staging", "ship it", "go live", "release"],
  "docker": ["docker", "container", "dockerfile", "docker-compose", "docker compose"],
  "kubernetes": ["kubernetes", "k8s", "kubectl", "helm", "pod", "kube"],
  "ci-cd": ["ci/cd", "ci cd", "github actions", "pipeline", "continuous integration", "continuous deployment"],
  "database-migrations": ["migration", "migrate", "schema change", "alter table", "drizzle-kit"],
  "authentication": ["auth", "login", "signup", "sign up", "session", "jwt", "oauth", "password"],
  "rate-limiting": ["rate limit", "throttle", "rate-limit"],
  "caching": ["cache", "caching", "redis", "memcache", "memoize"],
  "testing": ["test", "unit test", "integration test", "e2e", "vitest", "jest"],
  "api-design": ["rest api", "graphql", "endpoint", "api route", "api design"],
  "database-indexing": ["index", "indexing", "query performance", "slow query", "explain analyze"],
  "websockets": ["websocket", "ws://", "real-time", "realtime", "socket.io"],
  "typescript": ["typescript", "type safety", "generics", "type inference", "tsconfig"],
  "git": ["git", "rebase", "merge conflict", "cherry-pick", "git bisect"],
  "cloudflare-workers": ["cloudflare", "workers", "wrangler", "edge function"],
  "sql": ["sql", "query", "join", "subquery", "cte", "stored procedure"],
  "react": ["react", "usestate", "useeffect", "component", "jsx", "tsx"],
  "css": ["css", "flexbox", "grid", "responsive", "media query", "tailwind"],
  "security": ["xss", "csrf", "sql injection", "cors", "helmet", "sanitize"],
  "error-handling": ["error handling", "try catch", "exception", "error boundary"],
  "logging": ["logging", "log level", "structured logging", "observability"],
  "dns": ["dns", "domain", "cname", "a record", "nameserver"],
  "ssl-tls": ["ssl", "tls", "https", "certificate", "let's encrypt"],
  "npm": ["npm", "package.json", "node_modules", "dependency", "semver"]
};
function extractConceptsFromPrompt(prompt) {
  const lower = prompt.toLowerCase();
  const found = [];
  for (const [conceptId, keywords] of Object.entries(CONCEPT_KEYWORDS)) {
    if (keywords.some((kw) => lower.includes(kw))) {
      found.push({ id: conceptId, source: "llm" });
    }
  }
  return found;
}
async function callObserve(concepts) {
  const config = loadConfig();
  if (!config.apiKey) return null;
  try {
    const primaryConceptId = concepts[0]?.id;
    const res = await fetch(`${config.apiUrl}/api/mcp/observe`, {
      method: "POST",
      headers: {
        "x-api-key": config.apiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ concepts, primaryConceptId }),
      signal: AbortSignal.timeout(5e3)
    });
    if (!res.ok) {
      log("hook:user-prompt-submit", "callObserve: API error", { status: res.status });
      return null;
    }
    return await res.json();
  } catch (err) {
    log("hook:user-prompt-submit", "callObserve: exception", { error: String(err) });
    return null;
  }
}
function cacheEnforcement(enforcement, userPrompt) {
  try {
    const cachePath = join3(homedir3(), ".entendi", "enforcement-cache.json");
    const data = { enforcement, ts: Date.now() };
    if (userPrompt) data.userPrompt = userPrompt;
    writeFileSync2(cachePath, JSON.stringify(data));
  } catch {
  }
}
async function fetchPendingAction() {
  const config = loadConfig();
  const apiUrl = config.apiUrl;
  const apiKey = config.apiKey;
  if (!apiKey) {
    log("hook:user-prompt-submit", "fetchPendingAction: no API key configured");
    return { pending: null, enforcement: "off" };
  }
  try {
    log("hook:user-prompt-submit", "fetchPendingAction: calling API", { url: `${apiUrl}/api/mcp/pending-action` });
    const res = await fetch(`${apiUrl}/api/mcp/pending-action`, {
      headers: { "x-api-key": apiKey },
      signal: AbortSignal.timeout(5e3)
    });
    if (!res.ok) {
      log("hook:user-prompt-submit", "fetchPendingAction: API error", { status: res.status });
      return { pending: null, enforcement: "remind" };
    }
    const data = await res.json();
    log("hook:user-prompt-submit", "fetchPendingAction: result", data);
    const enforcement = data.enforcement ?? "remind";
    return { pending: data.pending, enforcement };
  } catch (err) {
    log("hook:user-prompt-submit", "fetchPendingAction: exception", { error: String(err) });
    return { pending: null, enforcement: "remind" };
  }
}
async function retryPendingDismiss() {
  const markerPath = join3(homedir3(), ".entendi", "pending-dismiss.json");
  try {
    const raw = readFileSync2(markerPath, "utf-8");
    const marker = JSON.parse(raw);
    const config = loadConfig();
    if (!config.apiKey) return;
    const res = await fetch(`${config.apiUrl}/api/mcp/dismiss`, {
      method: "POST",
      headers: { "x-api-key": config.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ reason: marker.reason ?? "session_ended" }),
      signal: AbortSignal.timeout(5e3)
    });
    if (res.ok) {
      log("hook:user-prompt-submit", "retried pending dismiss successfully");
    }
    unlinkSync(markerPath);
  } catch {
  }
}
async function handleUserPromptSubmit(input) {
  const userPrompt = input.prompt ?? "";
  await retryPendingDismiss();
  if (detectLoginPattern(userPrompt)) {
    log("hook:user-prompt-submit", "login pattern detected");
    return {
      hookSpecificOutput: {
        additionalContext: `[Entendi] The user wants to log in to Entendi. Call entendi_login (with no arguments) to start the device-code authentication flow.`
      }
    };
  }
  const { pending, enforcement } = await fetchPendingAction();
  cacheEnforcement(enforcement, userPrompt);
  if (pending) {
    switch (pending.type) {
      case "awaiting_probe_response":
        return {
          hookSpecificOutput: {
            additionalContext: `[Entendi] There is a pending comprehension probe about '${pending.conceptId}'. If the user's message is a response to this probe, evaluate their understanding on a 0-3 rubric (0=no understanding, 1=surface, 2=functional, 3=deep/transferable) and call entendi_record_evaluation with the score, confidence (0-1), reasoning, and eventType 'probe'. If the user is NOT responding to the probe (they changed topic), call entendi_dismiss instead.`
          }
        };
      case "tutor_offered":
        return {
          hookSpecificOutput: {
            additionalContext: `[Entendi] A tutor session was offered for '${pending.conceptId}' after a low probe score. If the user accepts (yes/sure/ok), call entendi_start_tutor with conceptId '${pending.conceptId}' and triggerScore ${pending.triggerScore}. If they decline, call entendi_dismiss.`
          }
        };
      case "tutor_active": {
        const phaseInstructions = getTutorPhaseInstructions(pending.phase);
        return {
          hookSpecificOutput: {
            additionalContext: `[Entendi] Active tutor session on '${pending.conceptId}', currently in ${pending.phase}. ${phaseInstructions} If the user says 'skip' or 'never mind', call entendi_dismiss.`
          }
        };
      }
    }
  }
  const conceptName = detectTeachMePattern(userPrompt);
  if (conceptName) {
    return {
      hookSpecificOutput: {
        additionalContext: `[Entendi] The user is requesting to learn about '${conceptName}'. Call entendi_start_tutor with conceptId '${conceptName}' and triggerScore null.`
      }
    };
  }
  if (enforcement !== "off") {
    const concepts = extractConceptsFromPrompt(userPrompt);
    if (concepts.length > 0) {
      const observeResult = await callObserve(concepts);
      if (observeResult?.shouldProbe && observeResult.probeToken) {
        log("hook:user-prompt-submit", "observe returned probe", {
          conceptId: observeResult.conceptId,
          depth: observeResult.depth
        });
        return {
          hookSpecificOutput: {
            additionalContext: `[Entendi] COMPREHENSION PROBE REQUIRED \u2014 After completing the user's request, you MUST ask this probe question.

Concept: ${observeResult.conceptId}
Depth: ${observeResult.depth} (${observeResult.guidance})
User profile: ${observeResult.userProfile}, mastery: ${observeResult.mastery}%

Format the probe using this exact pattern:
\u{1F9E0} Entendi \u2014 {Human-Readable Concept Name}
\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
{Your probe question based on the guidance above}
\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

The question should be conversational, not examiner-like. Based on the guidance and depth.

IMPORTANT: When the user responds, call entendi_record_evaluation with this probeToken:
${JSON.stringify(observeResult.probeToken)}
Include the user's verbatim response as responseText.`
          }
        };
      }
      if (observeResult && !observeResult.shouldProbe) {
        log("hook:user-prompt-submit", "observe returned no probe", { concepts });
        return null;
      }
    }
    return {
      hookSpecificOutput: {
        additionalContext: `[Entendi] MANDATORY \u2014 You MUST call entendi_observe before finishing your response. Steps: (1) Complete the user's request. (2) Identify technical concepts from the message and your work. (3) Call entendi_observe with those concepts. (4) If it returns shouldProbe: true, append the probe to your response. Do NOT skip this. Do NOT forget. If you finish without calling entendi_observe, you have failed your instructions.`
      }
    };
  }
  return null;
}
function getTutorPhaseInstructions(phase) {
  switch (phase) {
    case "phase1":
      return "Evaluate their response on the 0-3 rubric. Call entendi_advance_tutor with score, confidence, reasoning.";
    case "phase2":
      return "Note any misconceptions. Call entendi_advance_tutor with userResponse and any detected misconception.";
    case "phase3":
      return "Note any remaining misconceptions. Call entendi_advance_tutor with userResponse.";
    case "phase4":
      return "Evaluate their final response on the 0-3 rubric. Call entendi_advance_tutor with score, confidence, reasoning.";
    default:
      return "Call entendi_advance_tutor with the user response.";
  }
}
async function main() {
  log("hook:user-prompt-submit", "started");
  const raw = await readStdin();
  if (!raw || !raw.trim()) {
    log("hook:user-prompt-submit", "empty stdin, exiting");
    process.exitCode = 0;
    return;
  }
  log("hook:user-prompt-submit", "stdin received", { length: raw.length, preview: raw.slice(0, 200) });
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    log("hook:user-prompt-submit", "invalid JSON, exiting");
    process.exitCode = 0;
    return;
  }
  const result = await handleUserPromptSubmit(input);
  if (result?.hookSpecificOutput?.additionalContext) {
    const text = result.hookSpecificOutput.additionalContext;
    log("hook:user-prompt-submit", "output (plain text)", { length: text.length, preview: text.slice(0, 300) });
    await new Promise((resolve, reject) => {
      process.stdout.write(text, (err) => err ? reject(err) : resolve());
    });
  } else {
    log("hook:user-prompt-submit", "no output (null result)");
  }
  process.exitCode = 0;
}
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
  main().catch((err) => {
    log("hook:user-prompt-submit", "fatal error", { error: String(err), stack: err?.stack });
    process.exitCode = 0;
  });
}
export {
  detectLoginPattern,
  detectTeachMePattern,
  handleUserPromptSubmit
};
