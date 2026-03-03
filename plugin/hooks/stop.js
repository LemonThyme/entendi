#!/usr/bin/env node

// src/hooks/stop.ts
import { readFileSync as readFileSync2 } from "fs";
import { homedir as homedir3 } from "os";
import { join as join3 } from "path";

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

// src/hooks/transcript.ts
import { closeSync, fstatSync, openSync, readSync } from "fs";
var TAIL_BYTES = 50 * 1024;
function readTail(path) {
  try {
    const fd = openSync(path, "r");
    const stat = fstatSync(fd);
    const start = Math.max(0, stat.size - TAIL_BYTES);
    const buf = Buffer.alloc(Math.min(stat.size, TAIL_BYTES));
    readSync(fd, buf, 0, buf.length, start);
    closeSync(fd);
    return buf.toString("utf-8");
  } catch {
    return "";
  }
}
function parseLines(raw) {
  return raw.split("\n").filter((line) => line.trim()).map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return null;
    }
  }).filter(Boolean);
}
function isRealUserMessage(entry) {
  if (entry.type !== "user") return false;
  const content = entry.message?.content;
  if (typeof content === "string") return true;
  if (Array.isArray(content)) {
    return content.length > 0 && content[0].type !== "tool_result";
  }
  return false;
}
function extractUserText(entry) {
  const content = entry.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const text = content.find((b) => b.type === "text");
    return text?.text ?? "";
  }
  return "";
}
function hasObserveCallInCurrentTurn(transcriptPath) {
  const raw = readTail(transcriptPath);
  if (!raw) return false;
  const lines = parseLines(raw);
  let lastUserIdx = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (isRealUserMessage(lines[i])) {
      lastUserIdx = i;
      break;
    }
  }
  if (lastUserIdx === -1) return false;
  for (let i = lastUserIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.type !== "assistant") continue;
    const content = line?.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block.type === "tool_use" && typeof block.name === "string" && block.name.includes("entendi_observe")) {
        const toolUseId = block.id;
        if (toolUseId && isObserveCallFailed(lines, i, toolUseId)) {
          continue;
        }
        return true;
      }
    }
  }
  return false;
}
function isObserveCallFailed(lines, afterIdx, toolUseId) {
  for (let i = afterIdx + 1; i < lines.length; i++) {
    const content = lines[i]?.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block.type === "tool_result" && block.tool_use_id === toolUseId) {
        return block.is_error === true;
      }
    }
  }
  return false;
}
function findLastUserMessage(transcriptPath) {
  const raw = readTail(transcriptPath);
  if (!raw) return "";
  const lines = parseLines(raw);
  for (let i = lines.length - 1; i >= 0; i--) {
    if (isRealUserMessage(lines[i])) {
      return extractUserText(lines[i]);
    }
  }
  return "";
}

// src/hooks/trivial.ts
var TRIVIAL_PATTERNS = [
  /^(yes|no|ok|okay|sure|yep|yup|nah|nope|thanks|thank you|ty|thx|do it|go ahead|sounds good|lgtm|ship it|commit|push|deploy|done|agreed|correct|right|exactly|perfect|great|nice|cool|awesome|got it|understood|continue|proceed)[\s.!?,]*$/i
];
function isTrivialMessage(msg) {
  const trimmed = msg.trim();
  if (trimmed.length < 15) return true;
  return TRIVIAL_PATTERNS.some((p) => p.test(trimmed));
}

// src/hooks/stop.ts
function readEnforcementCache(homeDir) {
  try {
    const dir = homeDir ?? homedir3();
    const raw = readFileSync2(join3(dir, ".entendi", "enforcement-cache.json"), "utf-8");
    const data = JSON.parse(raw);
    if (Date.now() - data.ts > 5 * 60 * 1e3) return { enforcement: "remind" };
    return {
      enforcement: data.enforcement ?? "remind",
      userPrompt: data.userPrompt
    };
  } catch {
    return { enforcement: "remind" };
  }
}
async function handleStop(input, homeDir) {
  if (input.stop_hook_active) {
    log("hook:stop", "stop_hook_active is true, allowing stop");
    return null;
  }
  const cache = readEnforcementCache(homeDir);
  if (cache.enforcement === "off") {
    log("hook:stop", "enforcement is off, allowing stop");
    return null;
  }
  const transcriptPath = input.transcript_path;
  if (!transcriptPath) {
    log("hook:stop", "no transcript_path, allowing stop");
    return null;
  }
  if (hasObserveCallInCurrentTurn(transcriptPath)) {
    log("hook:stop", "observe was called this turn, allowing stop");
    return null;
  }
  const userMessage = cache.userPrompt ?? findLastUserMessage(transcriptPath);
  if (!userMessage || isTrivialMessage(userMessage)) {
    log("hook:stop", "trivial or empty message, skipping observe enforcement");
    return null;
  }
  if (cache.enforcement === "enforce") {
    log("hook:stop", "observe NOT called, blocking stop", { enforcement: cache.enforcement, userMessage: userMessage.slice(0, 100) });
    return {
      decision: "block",
      reason: `[Entendi] You did not call entendi_observe this turn. Identify technical concepts from the user's message and your work, then call entendi_observe before finishing.`
    };
  }
  log("hook:stop", "observe NOT called (remind mode, not blocking)", { userMessage: userMessage.slice(0, 100) });
  return null;
}
async function checkDanglingProbes() {
  const config = loadConfig();
  const apiUrl = config.apiUrl;
  const apiKey = config.apiKey;
  if (!apiKey) {
    log("hook:stop", "no API key configured, skipping dangling probe check");
    return;
  }
  try {
    log("hook:stop", "checking for dangling probes", { url: `${apiUrl}/api/mcp/pending-action` });
    const res = await fetch(`${apiUrl}/api/mcp/pending-action`, {
      headers: { "x-api-key": apiKey },
      signal: AbortSignal.timeout(5e3)
    });
    if (!res.ok) {
      log("hook:stop", "API error checking pending actions", { status: res.status });
      return;
    }
    const data = await res.json();
    if (data.pending) {
      log("hook:stop", "WARNING: dangling probe detected at session end", {
        type: data.pending.type,
        conceptId: data.pending.conceptId ?? "unknown"
      });
    } else {
      log("hook:stop", "no dangling probes found");
    }
  } catch (err) {
    log("hook:stop", "exception checking dangling probes", { error: String(err) });
  }
}
async function main() {
  log("hook:stop", "session ending");
  const raw = await readStdin();
  let input = { session_id: "", cwd: "", hook_event_name: "Stop" };
  try {
    input = JSON.parse(raw);
  } catch {
  }
  const result = await handleStop(input);
  if (result) {
    process.stdout.write(JSON.stringify(result));
    process.exitCode = 0;
    return;
  }
  await checkDanglingProbes();
  log("hook:stop", "done");
  process.exitCode = 0;
}
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
  main().catch((err) => {
    log("hook:stop", "fatal error", { error: String(err), stack: err?.stack });
    process.exitCode = 0;
  });
}
export {
  handleStop
};
