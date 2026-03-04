#!/usr/bin/env node

// src/hooks/session-end.ts
import { writeFileSync as writeFileSync2 } from "fs";
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

// src/hooks/session-end.ts
function writeDismissMarker(conceptId) {
  try {
    const markerPath = join3(homedir3(), ".entendi", "pending-dismiss.json");
    writeFileSync2(markerPath, JSON.stringify({
      conceptId,
      reason: "session_ended",
      ts: Date.now()
    }));
  } catch {
  }
}
async function cleanupSession() {
  const config = loadConfig();
  const { apiUrl, apiKey } = config;
  if (!apiKey) {
    log("hook:session-end", "no API key, skipping cleanup");
    return;
  }
  let lastConceptId = "unknown";
  try {
    const res = await fetch(`${apiUrl}/api/mcp/pending-action`, {
      headers: apiHeaders(config),
      signal: AbortSignal.timeout(5e3)
    });
    if (!res.ok) {
      log("hook:session-end", "API error checking pending actions", { status: res.status });
      return;
    }
    const data = await res.json();
    if (!data.pending) {
      log("hook:session-end", "no pending actions to clean up");
      return;
    }
    const { type, conceptId } = data.pending;
    lastConceptId = conceptId ?? "unknown";
    log("hook:session-end", "cleaning up pending action", { type, conceptId });
    if (type === "awaiting_probe_response" || type === "tutor_offered" || type === "tutor_active") {
      const dismissRes = await fetch(`${apiUrl}/api/mcp/dismiss`, {
        method: "POST",
        headers: {
          ...apiHeaders(config),
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ reason: "session_ended" }),
        signal: AbortSignal.timeout(5e3)
      });
      if (dismissRes.ok) {
        log("hook:session-end", "dismissed pending action", { type, conceptId });
      } else {
        log("hook:session-end", "failed to dismiss pending action", {
          status: dismissRes.status
        });
        writeDismissMarker(lastConceptId);
      }
    }
  } catch (err) {
    log("hook:session-end", "exception during cleanup", { error: String(err) });
    writeDismissMarker(lastConceptId);
  }
}
async function main() {
  const startTime = Date.now();
  log("hook:session-end", "session ending");
  await readStdin();
  await cleanupSession();
  const duration = Date.now() - startTime;
  log("hook:session-end", `done (${duration}ms)`);
  process.exitCode = 0;
}
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
  main().catch((err) => {
    log("hook:session-end", "fatal error", { error: String(err), stack: err?.stack });
    process.exitCode = 0;
  });
}
export {
  cleanupSession
};
