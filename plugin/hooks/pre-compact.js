#!/usr/bin/env node

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

// src/hooks/pre-compact.ts
async function fetchPendingState() {
  const config = loadConfig();
  const { apiUrl, apiKey } = config;
  if (!apiKey) {
    log("hook:pre-compact", "no API key, skipping state preservation");
    return null;
  }
  try {
    const res = await fetch(`${apiUrl}/api/mcp/pending-action`, {
      headers: { "x-api-key": apiKey },
      signal: AbortSignal.timeout(5e3)
    });
    if (!res.ok) {
      log("hook:pre-compact", "API error fetching pending state", { status: res.status });
      return null;
    }
    const data = await res.json();
    if (!data.pending) {
      log("hook:pre-compact", "no pending state to preserve");
      return null;
    }
    const { type, conceptId, phase } = data.pending;
    log("hook:pre-compact", "preserving pending state", { type, conceptId });
    switch (type) {
      case "awaiting_probe_response":
        return `[Entendi] PRESERVED STATE: There is a pending comprehension probe about '${conceptId}'. The user has been asked a probe question. If their next message responds to this probe, evaluate on a 0-3 rubric and call entendi_record_evaluation. If they changed topic, call entendi_dismiss.`;
      case "tutor_active":
        return `[Entendi] PRESERVED STATE: Active tutor session on '${conceptId}', phase: ${phase}. Continue the tutor dialogue. Call entendi_advance_tutor with the user's response.`;
      case "tutor_offered":
        return `[Entendi] PRESERVED STATE: A tutor session was offered for '${conceptId}'. If the user accepts, call entendi_start_tutor. If they decline, call entendi_dismiss.`;
      default:
        return `[Entendi] PRESERVED STATE: Pending action type '${type}' for concept '${conceptId}'.`;
    }
  } catch (err) {
    log("hook:pre-compact", "exception fetching state", { error: String(err) });
    return null;
  }
}
async function main() {
  log("hook:pre-compact", "context compaction starting");
  await readStdin();
  const stateContext = await fetchPendingState();
  if (stateContext) {
    log("hook:pre-compact", "outputting preserved state", { length: stateContext.length });
    await new Promise((resolve, reject) => {
      process.stdout.write(stateContext, (err) => err ? reject(err) : resolve());
    });
  } else {
    log("hook:pre-compact", "no state to preserve");
  }
  process.exitCode = 0;
}
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
  main().catch((err) => {
    log("hook:pre-compact", "fatal error", { error: String(err), stack: err?.stack });
    process.exitCode = 0;
  });
}
