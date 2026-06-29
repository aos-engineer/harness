// The real worker pass: one Council+Crew run via the AOS engine.
//
// This composes the adapter exactly as `runAdapterSession` does (the blessed
// path) but instantiates AOSEngine directly so we can read structured results
// (the assembled package, the cost) back out of the engine after start()
// returns. The whole deliberation happens here; Paperclip never sees it.
//
// One wake = one pass. The worker profile is an execution profile (workflow
// set, gate-free) so the entire run completes inside engine.start().

import { join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import {
  BaseEventBus,
  TerminalUI,
  BaseWorkflow,
  composeAdapter,
  discoverAgents,
  createFlatAgentsDir,
  buildToolPolicy,
  type ToolPolicy,
} from "@aos-harness/adapter-shared";
import { AOSEngine } from "@aos-harness/runtime";
import type { AOSAdapter } from "@aos-harness/runtime/types";
import { loadProfile, loadWorkflow, validateBrief } from "@aos-harness/runtime/config-loader";
import { getAdapterDir, type AdapterName } from "../utils";
import { getRuntimeAdapterModelConfig } from "../aos-config";
import { buildBrief } from "./brief";
import type { WorkerConfig } from "./config";
import type { PassInput, PassResult, RunPass } from "./types";

/** Context handed to an adapter factory so it can build the AOS adapter. */
export interface AdapterFactoryContext {
  cfg: WorkerConfig;
  toolPolicy: ToolPolicy;
  transcriptPath: string;
}

/** Builds the AOS adapter for a pass. Tests inject a MockAdapter here. */
export type AdapterFactory = (ctx: AdapterFactoryContext) => Promise<AOSAdapter> | AOSAdapter;

const ADAPTER_CLASS: Record<string, string> = {
  "claude-code": "ClaudeCodeAgentRuntime",
  gemini: "GeminiAgentRuntime",
  codex: "CodexAgentRuntime",
};

async function loadAdapterRuntime(platform: string): Promise<any> {
  const className = ADAPTER_CLASS[platform];
  if (!className) throw new Error(`Unknown adapter platform: ${platform}`);
  const dir = getAdapterDir(platform);
  if (!dir) throw new Error(`Adapter not installed: ${platform} (no src/index.ts found)`);
  const mod = await import(pathToFileURL(join(dir, "src", "index.ts")).href);
  const cls = mod[className];
  if (!cls) throw new Error(`Adapter ${platform} is missing export ${className}`);
  return cls;
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Default factory: the real claude-code adapter (shells out to the `claude` CLI). */
async function defaultAdapterFactory(ctx: AdapterFactoryContext): Promise<AOSAdapter> {
  const RuntimeClass = await loadAdapterRuntime(ctx.cfg.platform);
  const modelCfg = getRuntimeAdapterModelConfig(ctx.cfg.root, ctx.cfg.platform as AdapterName);
  const eventBus = new BaseEventBus();
  const agentRuntime = new RuntimeClass(eventBus, modelCfg.modelOverrides, {
    useVendorDefaultModel: modelCfg.useVendorDefaultModel,
  });
  const ui = new TerminalUI();
  const workflow = new BaseWorkflow(agentRuntime, ctx.cfg.root, {
    toolPolicy: ctx.toolPolicy,
    transcriptPath: ctx.transcriptPath,
  });
  return composeAdapter(agentRuntime, eventBus, ui, workflow);
}

/**
 * Build the production RunPass. The returned function runs one full worker pass
 * for a single issue and returns the assembled package + cost. The default
 * adapter requires the provider key (ANTHROPIC_API_KEY) and the `claude` CLI in
 * the process environment — supplied at deploy time, never in code. Tests inject
 * `opts.adapterFactory` (a MockAdapter) to exercise this whole path with no model.
 */
export function createEnginePass(
  cfg: WorkerConfig,
  opts: { adapterFactory?: AdapterFactory } = {},
): RunPass {
  const makeAdapter = opts.adapterFactory ?? defaultAdapterFactory;
  return async (input: PassInput): Promise<PassResult> => {
    const profile = loadProfile(cfg.profileDir);
    if (!profile.workflow) {
      throw new Error(`Profile ${profile.id} has no workflow; expected an execution profile`);
    }
    const toolPolicy = buildToolPolicy(profile.tools!, {});

    // Validate the workflow up front using the SAME resolution the engine uses
    // (engine: loadWorkflow(join(workflowsDir, profile.workflow))). loadWorkflow
    // accepts a directory (<dir>/workflow.yaml) or a direct .yaml path.
    loadWorkflow(join(cfg.workflowsDir, profile.workflow));

    const date = todayUtc();
    const sessionId = `${date}-paperclip-${slug(input.issue.id)}-${Date.now().toString(36)}`;
    const deliberationDir = join(cfg.root, ".aos", "sessions", sessionId);
    mkdirSync(deliberationDir, { recursive: true });

    const briefText = buildBrief({ issue: input.issue, date });
    const briefPath = join(deliberationDir, "brief.md");
    writeFileSync(briefPath, briefText, "utf-8");

    const validation = validateBrief(briefPath, profile.input.required_sections);
    if (!validation.valid) {
      throw new Error(
        `Generated brief missing required sections: ${validation.missing.map((m) => m.heading).join(", ")}`,
      );
    }

    const transcriptPath = join(deliberationDir, "transcript.jsonl");
    const adapter = await makeAdapter({ cfg, toolPolicy, transcriptPath });

    const agentsDir = join(cfg.root, "core", "agents");
    const agentMap = discoverAgents(agentsDir);
    const flatAgentsDir = createFlatAgentsDir(cfg.root, agentMap);

    const engine = new AOSEngine(adapter, cfg.profileDir, {
      agentsDir: flatAgentsDir,
      workflowsDir: cfg.workflowsDir,
      projectDir: cfg.root,
      onTranscriptEvent: () => {},
    });

    await engine.start(briefPath, { deliberationDir });

    if (!engine.isWorkflowMode()) {
      throw new Error("Worker profile did not run in workflow mode");
    }

    const cs = engine.getConstraintState();
    const results = engine.getWorkflowResults();
    const sections: Record<string, string> = {};
    if (results) {
      for (const [k, v] of results) {
        sections[k] = typeof v === "string" ? v : JSON.stringify(v, null, 2);
      }
    }

    const pkg =
      sections["work_product"] ??
      sections["synthesis"] ??
      sections["dev_execution_report"] ??
      Object.values(sections).at(-1) ??
      "";

    return {
      package: pkg,
      costUsd: cs.budget_spent,
      rounds: cs.rounds_completed,
      elapsedMinutes: cs.elapsed_minutes,
      sections,
      briefPath,
      transcriptPath,
    };
  };
}

function slug(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 40);
}
