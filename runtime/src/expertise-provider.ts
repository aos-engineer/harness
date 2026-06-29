import type {
  MemoryProvider,
  MemoryConfig,
  WakeContext,
  RecallOpts,
  RecallResult,
  RecallEntry,
  RememberOpts,
  RememberId,
  HealthStatus,
  MemoryStatus,
} from "./memory-provider";
import { fuzzyScore } from "./fuzzy-match";
import { randomUUID } from "node:crypto";

interface StoredMemory {
  id: string;
  content: string;
  projectId: string;
  agentId: string;
  hall: string;
  timestamp: string;
}

const FUZZY_THRESHOLD = 0.35;

/**
 * Complement fuzzyScore with substring matching.
 * Handles prefix matches like "auth" → "authentication"
 * that token-level Levenshtein misses.
 */
function substringScore(query: string, content: string): number {
  const qTokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  const contentLower = content.toLowerCase();
  if (qTokens.length === 0) return 0;

  let matches = 0;
  for (const qt of qTokens) {
    if (contentLower.includes(qt)) {
      matches++;
    }
  }
  return matches / qTokens.length;
}

function combinedScore(query: string, content: string): number {
  return Math.max(fuzzyScore(query, content), substringScore(query, content) * 0.8);
}

export class ExpertiseProvider implements MemoryProvider {
  readonly id = "expertise";
  readonly name = "Basic Expertise";

  private memories: StoredMemory[] = [];
  private config: MemoryConfig | null = null;

  async initialize(config: MemoryConfig): Promise<void> {
    this.config = config;
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async healthCheck(): Promise<HealthStatus> {
    return { healthy: true, latencyMs: 0 };
  }

  async wake(projectId: string, agentId?: string): Promise<WakeContext> {
    const relevant = this.memories.filter(
      (m) => m.projectId === projectId && (!agentId || m.agentId === agentId),
    );

    if (relevant.length === 0) {
      return { identity: "", essentials: "", tokenEstimate: 0, truncated: false };
    }

    const essentials = relevant.map((m) => `- [${m.agentId}/${m.hall}] ${m.content}`).join("\n");
    const tokenEstimate = Math.ceil(essentials.length / 4);

    return { identity: "", essentials, tokenEstimate, truncated: false };
  }

  async recall(query: string, opts: RecallOpts): Promise<RecallResult> {
    const candidates = this.memories.filter(
      (m) =>
        m.projectId === opts.projectId &&
        (!opts.agentId || m.agentId === opts.agentId) &&
        (!opts.hall || m.hall === opts.hall),
    );

    const scored = candidates
      .map((m) => ({
        memory: m,
        score: combinedScore(query, m.content),
      }))
      .filter((s) => s.score >= FUZZY_THRESHOLD)
      .sort((a, b) => b.score - a.score)
      .slice(0, opts.maxResults ?? 5);

    const entries: RecallEntry[] = scored.map((s) => ({
      content: s.memory.content,
      wing: s.memory.projectId,
      room: s.memory.agentId,
      hall: s.memory.hall,
      similarity: s.score,
    }));

    const tokenEstimate = entries.reduce((sum, e) => sum + Math.ceil(e.content.length / 4), 0);

    return { entries, tokenEstimate };
  }

  async remember(content: string, opts: RememberOpts): Promise<RememberId> {
    const id = randomUUID();
    this.memories.push({
      id,
      content,
      projectId: opts.projectId,
      agentId: opts.agentId,
      hall: opts.hall ?? "hall_facts",
      timestamp: new Date().toISOString(),
    });
    return id;
  }

  async status(): Promise<MemoryStatus> {
    return {
      provider: "expertise",
      available: true,
      drawerCount: this.memories.length,
    };
  }
}
