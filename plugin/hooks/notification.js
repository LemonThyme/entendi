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
    apiKey: fileConfig.apiKey || process.env.ENTENDI_API_KEY || void 0,
    orgId: fileConfig.orgId
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
function apiHeaders(config) {
  const headers = { "x-api-key": config.apiKey };
  if (config.orgId) headers["X-Org-Id"] = config.orgId;
  return headers;
}

// src/hooks/notification.ts
async function checkPendingProbe() {
  const config = loadConfig();
  const { apiUrl, apiKey } = config;
  if (!apiKey) {
    return null;
  }
  try {
    const res = await fetch(`${apiUrl}/api/mcp/pending-action`, {
      headers: apiHeaders(config),
      signal: AbortSignal.timeout(5e3)
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.pending) return null;
    if (data.pending.type === "awaiting_probe_response") {
      return `[Entendi] Reminder: A comprehension probe about '${data.pending.conceptId}' is waiting for your response.`;
    }
    if (data.pending.type === "tutor_active") {
      return `[Entendi] Reminder: An active tutor session on '${data.pending.conceptId}' is waiting for your response.`;
    }
    return null;
  } catch (err) {
    log("hook:notification", "exception checking pending", { error: String(err) });
    return null;
  }
}
async function main() {
  log("hook:notification", "idle_prompt notification");
  await readStdin();
  const reminder = await checkPendingProbe();
  if (reminder) {
    log("hook:notification", "pending probe reminder", { length: reminder.length });
    await new Promise((resolve, reject) => {
      process.stdout.write(reminder, (err) => err ? reject(err) : resolve());
    });
  } else {
    log("hook:notification", "no pending probes");
  }
  process.exitCode = 0;
}
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
  main().catch((err) => {
    log("hook:notification", "fatal error", { error: String(err), stack: err?.stack });
    process.exitCode = 0;
  });
}
