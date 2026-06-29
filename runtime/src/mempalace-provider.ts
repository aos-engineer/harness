// runtime/src/mempalace-provider.ts

import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { McpClient } from "./mcp-client";
import type {
  MemoryProvider,
  MemoryConfig,
  MempalaceConfig,
  HealthStatus,
  WakeContext,
  RecallOpts,
  RecallResult,
  RecallEntry,
  RememberOpts,
  RememberId,
  MemoryStatus,
} from "./memory-provider";

/** Rough token estimate: ~4 chars per token */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

interface FallbackEntry {
  content: string;
  opts: RememberOpts;
  timestamp: string;
}

export class MemPalaceProvider implements MemoryProvider {
  readonly id = "mempalace";
  readonly name = "MemPalace";

  private client: McpClient;
  private config!: MempalaceConfig;
  private fallbackQueue: FallbackEntry[] = [];

  constructor(client: McpClient) {
    this.client = client;
  }

  async initialize(config: MemoryConfig): Promise<void> {
    if (!config.mempalace) {
      throw new Error("MemPalaceProvider requires mempalace config");
    }
    this.config = config.mempalace;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const health = await this.client.healthCheck();
      return health.healthy;
    } catch {
      return false;
    }
  }

  async healthCheck(): Promise<HealthStatus> {
    return this.client.healthCheck();
  }

  async wake(projectId: string, agentId?: string): Promise<WakeContext> {
    const params: Record<string, unknown> = {
      wing: projectId,
      layers: this.config.wakeLayers,
    };
    if (agentId) params.room = agentId;

    const raw = await this.callToolWithRecovery("mempalace_search", params);
    const parsed = this.parseToolResult(raw);
    const results: RecallEntry[] = (parsed.results as RecallEntry[] | undefined) ?? [];

    // Sort by similarity descending so we keep the most relevant
    results.sort((a, b) => b.similarity - a.similarity);

    let totalTokens = 0;
    const kept: RecallEntry[] = [];
    let truncated = false;

    for (const entry of results) {
      const entryTokens = estimateTokens(entry.content);
      if (totalTokens + entryTokens > this.config.maxWakeTokens) {
        truncated = true;
        break;
      }
      kept.push(entry);
      totalTokens += entryTokens;
    }

    const essentials = kept.map((e) => e.content).join("\n---\n");

    return {
      identity: `${projectId}${agentId ? `/${agentId}` : ""}`,
      essentials,
      tokenEstimate: totalTokens,
      truncated,
    };
  }

  async recall(query: string, opts: RecallOpts): Promise<RecallResult> {
    const params: Record<string, unknown> = {
      query,
      wing: opts.projectId,
    };
    if (opts.agentId) params.room = opts.agentId;
    if (opts.hall) params.hall = opts.hall;
    if (opts.maxResults) params.max_results = opts.maxResults;

    const raw = await this.callToolWithRecovery("mempalace_search", params);
    const parsed = this.parseToolResult(raw);
    const rawResults = (parsed.results as Record<string, unknown>[] | undefined) ?? [];
    const entries: RecallEntry[] = rawResults.map(
      (r: Record<string, unknown>) => ({
        content: r.content as string,
        wing: r.wing as string,
        room: r.room as string,
        hall: r.hall as string,
        similarity: r.similarity as number,
        source: r.source as string | undefined,
      }),
    );

    const tokenEstimate = entries.reduce(
      (sum, e) => sum + estimateTokens(e.content),
      0,
    );

    return { entries, tokenEstimate };
  }

  async remember(content: string, opts: RememberOpts): Promise<RememberId> {
    const tokens = estimateTokens(content);
    if (tokens > this.config.maxDrawerTokens) {
      throw new Error(
        `Content (${tokens} tokens) exceeds maxDrawerTokens (${this.config.maxDrawerTokens})`,
      );
    }

    const params: Record<string, unknown> = {
      content,
      wing: opts.projectId,
      room: opts.agentId,
    };
    if (opts.hall) params.hall = opts.hall;
    if (opts.source) params.source = opts.source;
    if (opts.sessionId) params.session_id = opts.sessionId;

    try {
      const raw = await this.callToolWithRecovery("mempalace_add_drawer", params);
      const parsed = this.parseToolResult(raw);
      return parsed.id as string;
    } catch (err) {
      // Queue for fallback write
      this.fallbackQueue.push({
        content,
        opts,
        timestamp: new Date().toISOString(),
      });
      throw err;
    }
  }

  async status(): Promise<MemoryStatus> {
    const available = await this.isAvailable();
    if (!available) {
      return { provider: "mempalace", available: false };
    }

    try {
      const raw = await this.callToolWithRecovery("mempalace_status", {});
      const parsed = this.parseToolResult(raw);

      return {
        provider: "mempalace",
        available: true,
        drawerCount: parsed.total_drawers as number | undefined,
        wings: parsed.wings
          ? Object.keys(parsed.wings as Record<string, unknown>)
          : undefined,
      };
    } catch {
      return { provider: "mempalace", available: false };
    }
  }

  /**
   * Writes queued fallback memories to a JSONL file.
   * Called by the engine on crash or session end when MCP recovery fails.
   */
  writeFallback(sessionDir: string): number {
    if (this.fallbackQueue.length === 0) return 0;

    if (!existsSync(sessionDir)) {
      mkdirSync(sessionDir, { recursive: true });
    }

    const filePath = join(sessionDir, "fallback-memories.jsonl");
    const lines = this.fallbackQueue.map((entry) => JSON.stringify(entry));
    writeFileSync(filePath, lines.join("\n") + "\n", { flag: "a" });

    const count = this.fallbackQueue.length;
    this.fallbackQueue = [];
    return count;
  }

  // ── Private helpers ─────────────────────────────────────────────

  private async callToolWithRecovery(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    try {
      return await this.client.call("tools/call", {
        name: toolName,
        arguments: args,
      });
    } catch (firstError) {
      // One restart attempt then retry
      try {
        await this.client.restart();
        return await this.client.call("tools/call", {
          name: toolName,
          arguments: args,
        });
      } catch {
        throw firstError;
      }
    }
  }

  private parseToolResult(raw: unknown): Record<string, unknown> {
    if (!raw || typeof raw !== "object") return {};

    const result = raw as { content?: Array<{ text?: string }> };
    if (!result.content || !Array.isArray(result.content)) return {};

    const firstText = result.content[0]?.text;
    if (!firstText) return {};

    try {
      return JSON.parse(firstText) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
}
