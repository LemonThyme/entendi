import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { KnowledgeGraph } from './knowledge-graph.js';
import type { PendingProbe, ProbeSessionState, TutorSession } from '../schemas/types.js';

/**
 * Manages persistent state for Entendi (knowledge graph + probe session).
 *
 * IMPORTANT: This implementation assumes hooks execute sequentially within
 * Claude Code (PostToolUse completes before the next UserPromptSubmit fires).
 * Concurrent access from multiple hook instances could corrupt state.
 * Phase 1 should use file locking or atomic writes (write-to-temp + rename).
 */
export class StateManager {
  private dataDir: string;
  private userId: string;
  private kg: KnowledgeGraph;
  private probeSession: ProbeSessionState;
  private tutorSession: TutorSession | null;

  constructor(dataDir: string, userId: string) {
    this.dataDir = dataDir;
    this.userId = userId;
    mkdirSync(dataDir, { recursive: true });
    this.kg = this.loadKnowledgeGraph();
    this.probeSession = this.loadProbeSession();
    this.tutorSession = this.loadTutorSession();
  }

  getKnowledgeGraph(): KnowledgeGraph { return this.kg; }

  getProbeSession(): ProbeSessionState { return this.probeSession; }

  setPendingProbe(probe: PendingProbe): void {
    this.probeSession.pendingProbe = probe;
    this.probeSession.lastProbeTime = new Date().toISOString();
    this.probeSession.probesThisSession++;
  }

  clearPendingProbe(): void {
    this.probeSession.pendingProbe = null;
  }

  getTutorSession(): TutorSession | null { return this.tutorSession; }

  setTutorSession(session: TutorSession): void {
    this.tutorSession = session;
  }

  clearTutorSession(): void {
    this.tutorSession = null;
  }

  save(): void {
    writeFileSync(join(this.dataDir, 'knowledge-graph.json'), this.kg.toJSON());
    writeFileSync(join(this.dataDir, 'probe-session.json'), JSON.stringify(this.probeSession, null, 2));
    writeFileSync(join(this.dataDir, 'tutor-session.json'), JSON.stringify(this.tutorSession, null, 2));
  }

  private loadKnowledgeGraph(): KnowledgeGraph {
    const path = join(this.dataDir, 'knowledge-graph.json');
    try {
      if (existsSync(path)) return KnowledgeGraph.fromJSON(readFileSync(path, 'utf-8'));
    } catch {
      // Corrupted state file; reset to defaults
    }
    return new KnowledgeGraph();
  }

  private loadProbeSession(): ProbeSessionState {
    const path = join(this.dataDir, 'probe-session.json');
    try {
      if (existsSync(path)) return JSON.parse(readFileSync(path, 'utf-8'));
    } catch {
      // Corrupted state file; reset to defaults
    }
    return { pendingProbe: null, lastProbeTime: null, probesThisSession: 0 };
  }

  private loadTutorSession(): TutorSession | null {
    const path = join(this.dataDir, 'tutor-session.json');
    try {
      if (existsSync(path)) {
        const data = JSON.parse(readFileSync(path, 'utf-8'));
        if (data && typeof data === 'object' && data.sessionId) return data;
      }
    } catch {
      // Corrupted file — reset
    }
    return null;
  }
}
