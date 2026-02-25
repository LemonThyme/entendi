import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { KnowledgeGraph } from './knowledge-graph.js';
import type { PendingProbe, ProbeSessionState } from '../schemas/types.js';

export class StateManager {
  private dataDir: string;
  private userId: string;
  private kg: KnowledgeGraph;
  private probeSession: ProbeSessionState;

  constructor(dataDir: string, userId: string) {
    this.dataDir = dataDir;
    this.userId = userId;
    mkdirSync(dataDir, { recursive: true });
    this.kg = this.loadKnowledgeGraph();
    this.probeSession = this.loadProbeSession();
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

  save(): void {
    writeFileSync(join(this.dataDir, 'knowledge-graph.json'), this.kg.toJSON());
    writeFileSync(join(this.dataDir, 'probe-session.json'), JSON.stringify(this.probeSession, null, 2));
  }

  private loadKnowledgeGraph(): KnowledgeGraph {
    const path = join(this.dataDir, 'knowledge-graph.json');
    if (existsSync(path)) return KnowledgeGraph.fromJSON(readFileSync(path, 'utf-8'));
    return new KnowledgeGraph();
  }

  private loadProbeSession(): ProbeSessionState {
    const path = join(this.dataDir, 'probe-session.json');
    if (existsSync(path)) return JSON.parse(readFileSync(path, 'utf-8'));
    return { pendingProbe: null, lastProbeTime: null, probesThisSession: 0 };
  }
}
