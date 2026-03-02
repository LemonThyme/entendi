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
    return {
      hookSpecificOutput: {
        additionalContext: `[Entendi] MANDATORY: After completing the user's request, identify technical concepts discussed and call entendi_observe. Do not skip this step.`
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
