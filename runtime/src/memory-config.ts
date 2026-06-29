// runtime/src/memory-config.ts
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";
import type { MemoryConfig } from "./memory-provider";

export class MemoryConfigError extends Error {
  constructor(message: string, public path: string) {
    super(`Memory config error in ${path}: ${message}`);
    this.name = "MemoryConfigError";
  }
}

const DEFAULTS: MemoryConfig = {
  provider: "expertise",
  expertise: { maxLines: 200, scope: "per-project" },
  orchestrator: {
    rememberPrompt: "session_end",
    recallGate: true,
    maxRecallPerSession: 10,
  },
};

const MEMPALACE_DEFAULTS = {
  wakeLayers: ["L0", "L1"] as ("L0" | "L1")[],
  autoHall: true,
  maxWakeTokens: 1200,
  maxDrawerTokens: 500,
};

export function loadMemoryConfig(projectDir: string): MemoryConfig {
  const configPath = join(projectDir, ".aos", "memory.yaml");

  if (!existsSync(configPath)) {
    return { ...DEFAULTS };
  }

  const raw = readFileSync(configPath, "utf-8");
  const parsed = yaml.load(raw, { schema: yaml.JSON_SCHEMA }) as Record<
    string,
    unknown
  >;

  if (!parsed || typeof parsed !== "object") {
    throw new MemoryConfigError(
      "memory.yaml is empty or invalid",
      configPath,
    );
  }

  if (parsed.api_version !== "aos/memory/v1") {
    throw new MemoryConfigError(
      `Unknown api_version "${parsed.api_version}", expected "aos/memory/v1"`,
      configPath,
    );
  }

  const provider = parsed.provider as string;
  if (provider !== "mempalace" && provider !== "expertise") {
    throw new MemoryConfigError(
      `Invalid provider "${provider}", expected "mempalace" or "expertise"`,
      configPath,
    );
  }

  const orch = parsed.orchestrator as Record<string, unknown> | undefined;
  const orchestrator = {
    rememberPrompt:
      (orch?.remember_prompt as "session_end" | "per_round") ?? "session_end",
    recallGate: (orch?.recall_gate as boolean) ?? true,
    maxRecallPerSession: (orch?.max_recall_per_session as number) ?? 10,
  };

  const config: MemoryConfig = { provider, orchestrator };

  if (provider === "mempalace" && parsed.mempalace) {
    const mp = parsed.mempalace as Record<string, unknown>;
    config.mempalace = {
      palacePath: mp.palace_path as string,
      projectWing: mp.project_wing as string,
      wakeLayers:
        (mp.wake_layers as ("L0" | "L1")[]) ?? MEMPALACE_DEFAULTS.wakeLayers,
      autoHall: (mp.auto_hall as boolean) ?? MEMPALACE_DEFAULTS.autoHall,
      maxWakeTokens:
        (mp.max_wake_tokens as number) ?? MEMPALACE_DEFAULTS.maxWakeTokens,
      maxDrawerTokens:
        (mp.max_drawer_tokens as number) ?? MEMPALACE_DEFAULTS.maxDrawerTokens,
    };
  }

  if (parsed.expertise) {
    const ex = parsed.expertise as Record<string, unknown>;
    config.expertise = {
      maxLines: (ex.max_lines as number) ?? 200,
      scope: (ex.scope as "per-project" | "global") ?? "per-project",
    };
  }

  return config;
}
