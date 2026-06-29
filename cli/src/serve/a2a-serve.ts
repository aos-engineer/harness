// ── a2a-serve (Phase 4 — skill-routed A2A ingress entrypoint) ────
//
// Serves an AOS assembly AS an A2A agent, skill-routed: each inbound request is
// routed to ONE AOS skill (not the full deliberation assembly) and run on a
// WARM workflow/handle reused across requests — focused work + no cold start =
// excellent performance. A skill bound via mcp_binding resolves to a native MCP
// tool call (no LLM round-trip).
//
// Run (after `aos serve` registration, or directly):
//   AOS_A2A_PORT=8080 AOS_A2A_PUBLIC_URL=https://me.example.com \
//   AOS_A2A_AUTH_TOKEN=… AOS_A2A_WORKER_AGENT=arbiter \
//   bun run cli/src/serve/a2a-serve.ts <projectRoot>
//
// startA2aServe / loadA2aServeConfig / skillRunnerFromWorkflow are unit-tested;
// the import.meta.main warm-runtime bootstrap is the live deployment wiring.

import { readdirSync, statSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createPrivateKey, createPublicKey, type KeyObject } from "node:crypto";
import { loadSkill, loadAgent } from "@aos-harness/runtime/config-loader";
import type { AgentHandle, SkillResult } from "@aos-harness/runtime/types";
import { A2aServer } from "@aos-harness/runtime/a2a-server";
import { buildJwks, type JwsAlg } from "@aos-harness/runtime/jws";
import { IngressGuard, PerCallerGuard, type IngressLimiter } from "@aos-harness/runtime/ingress-guard";
import { A2aSkillRouter, type SkillRunner, type A2aExposedSkill } from "@aos-harness/runtime/a2a-skill-router";
import { handleRequest } from "../paperclip/http";
import { buildA2aServerDeps } from "../paperclip/a2a-ingress";

export interface A2aServeConfig {
  port: number;
  /** Interface to bind. Defaults to loopback (127.0.0.1) — public exposure is
   *  an explicit opt-in via AOS_A2A_BIND. */
  bindHost: string;
  cardName: string;
  cardDescription?: string;
  endpointUrl: string;
  authToken?: string;
  skills: A2aExposedSkill[];
  /** JWS Agent Card signing (loaded from AOS_A2A_SIGNING_KEY). */
  signing?: { privateKey: KeyObject; alg?: JwsAlg; kid?: string; jku?: string };
  /** Rate/budget/concurrency guard for inbound message/send (global, or
   *  per-caller fair-share when AOS_A2A_CALLER_KEY_HEADER is set). */
  guard?: IngressLimiter;
  /** Request header carrying the caller identity for per-caller limits. */
  callerKeyHeader?: string;
  /** Max ms to await the per-request executor (hung-executor slot-leak guard). */
  executorTimeoutMs?: number;
}

/** Derive the exposed A2A skills from a project's core/skills/. */
export function loadExposedSkills(projectRoot: string): A2aExposedSkill[] {
  const dir = join(projectRoot, "core", "skills");
  if (!existsSync(dir)) return [];
  const out: A2aExposedSkill[] = [];
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry);
    try {
      if (!statSync(full).isDirectory() || !existsSync(join(full, "skill.yaml"))) continue;
    } catch {
      continue;
    }
    const skill = loadSkill(full);
    out.push({ id: skill.id, name: skill.name, description: skill.description, tags: [], aosSkill: skill.id });
  }
  return out;
}

export function loadA2aServeConfig(
  projectRoot: string,
  env: Record<string, string | undefined> = process.env,
): A2aServeConfig {
  const port = Number(env.AOS_A2A_PORT ?? 8080);
  const publicUrl = (env.AOS_A2A_PUBLIC_URL ?? `http://localhost:${port}`).replace(/\/+$/, "");

  // Bind loopback by default so the endpoint is NOT reachable off-host unless
  // the operator consciously exposes it via AOS_A2A_BIND (CWE-1327).
  const bindHost = env.AOS_A2A_BIND?.trim() || "127.0.0.1";
  const isLoopbackBind =
    bindHost === "127.0.0.1" || bindHost === "::1" || bindHost === "localhost" || /^127\./.test(bindHost);

  // Signing is opt-in via AOS_A2A_SIGNING_KEY. If it is SET but unusable
  // (typo, unmounted secret), fail closed — never silently serve an unsigned
  // card when the operator asked for signing.
  let signing: A2aServeConfig["signing"];
  const keyPath = env.AOS_A2A_SIGNING_KEY;
  if (keyPath) {
    if (!existsSync(keyPath)) {
      // Don't echo the resolved key path into logs (CWE-209) — name the var only.
      throw new Error(`a2a serve: AOS_A2A_SIGNING_KEY is set but the file is not found or unreadable`);
    }
    signing = {
      privateKey: createPrivateKey(readFileSync(keyPath, "utf-8")),
      alg: (env.AOS_A2A_SIGNING_ALG as JwsAlg | undefined) ?? "ES256",
      kid: env.AOS_A2A_SIGNING_KID,
      // Advertise a JWKS URL for key discovery: the locally-served endpoint by
      // default, or an explicit AOS_A2A_SIGNING_JKU (e.g. a CDN-hosted JWKS).
      jku: env.AOS_A2A_SIGNING_JKU?.trim() || `${publicUrl}/.well-known/jwks.json`,
    };
  }

  // Ingress guard is always on with sane defaults (fail-safe for a public
  // endpoint); operators tune the three dimensions via env. The AOS_A2A_*
  // limits are the GLOBAL (aggregate) caps.
  const num = (v: string | undefined) =>
    v !== undefined && v !== "" && !Number.isNaN(Number(v)) ? Number(v) : undefined;
  const globalLimits = {
    maxConcurrent: num(env.AOS_A2A_MAX_CONCURRENT),
    requestsPerWindow: num(env.AOS_A2A_RATE_PER_MIN),
    budgetPerWindow: num(env.AOS_A2A_BUDGET_PER_MIN),
  };

  // Per-caller fair-share is opt-in: setting AOS_A2A_CALLER_KEY_HEADER names
  // the request header (set by a trusted upstream) that identifies the caller.
  // Then each caller gets its own AOS_A2A_PER_CALLER_* bucket behind the global
  // backstop. Without it, one shared global bucket (unchanged behavior).
  const callerKeyHeader = env.AOS_A2A_CALLER_KEY_HEADER?.trim() || undefined;
  let guard: IngressLimiter;
  if (callerKeyHeader) {
    guard = new PerCallerGuard({
      perCaller: {
        maxConcurrent: num(env.AOS_A2A_PER_CALLER_MAX_CONCURRENT),
        requestsPerWindow: num(env.AOS_A2A_PER_CALLER_RATE_PER_MIN),
        budgetPerWindow: num(env.AOS_A2A_PER_CALLER_BUDGET_PER_MIN),
      },
      global: globalLimits,
      maxCallers: num(env.AOS_A2A_MAX_CALLERS),
    });
  } else {
    guard = new IngressGuard(globalLimits);
  }

  const authToken = env.AOS_A2A_AUTH_TOKEN?.trim() || undefined;

  // Fail closed: exposing the endpoint off-host (non-loopback bind) without an
  // auth token would serve an unauthenticated, expensive A2A agent to the
  // network (CWE-306). Require a token, or an explicit anonymous opt-in.
  const allowAnon = /^(1|true|yes)$/i.test(env.AOS_A2A_ALLOW_ANON?.trim() ?? "");
  if (!isLoopbackBind && !authToken && !allowAnon) {
    throw new Error(
      `a2a serve: refusing to bind public interface "${bindHost}" without AOS_A2A_AUTH_TOKEN. ` +
        `Set a token, bind loopback (default), or set AOS_A2A_ALLOW_ANON=1 to serve anonymously on purpose.`,
    );
  }

  return {
    port,
    bindHost,
    cardName: env.AOS_A2A_CARD_NAME ?? "aos",
    cardDescription: env.AOS_A2A_CARD_DESCRIPTION,
    endpointUrl: `${publicUrl}/a2a`,
    authToken,
    skills: loadExposedSkills(projectRoot),
    signing,
    guard,
    callerKeyHeader,
    executorTimeoutMs: num(env.AOS_A2A_EXEC_TIMEOUT_MS) ?? 120_000,
  };
}

/** Build + start the A2A server. The runSkill is the engine-backed executor. */
export function startA2aServe(cfg: A2aServeConfig, runSkill: SkillRunner): ReturnType<typeof Bun.serve> {
  if (!cfg.skills.length) {
    throw new Error("a2a serve: no skills found under core/skills — nothing to expose");
  }
  const router = new A2aSkillRouter({ skills: cfg.skills, runSkill });
  const server = new A2aServer({
    card: { name: cfg.cardName, description: cfg.cardDescription, skills: router.cardSkills() },
    endpointUrl: cfg.endpointUrl,
    executor: router.executor(),
    signing: cfg.signing,
    guard: cfg.guard,
    executorTimeoutMs: cfg.executorTimeoutMs,
  });
  // Serve the signing public key as a JWKS so clients can resolve the card's
  // `jku` and verify by published key (key discovery / rotation).
  const jwks = cfg.signing
    ? () => buildJwks([createPublicKey(cfg.signing!.privateKey)])
    : undefined;
  const a2a = buildA2aServerDeps(server, {
    authToken: cfg.authToken,
    callerKeyHeader: cfg.callerKeyHeader,
    jwks,
  });
  if (!cfg.authToken) {
    console.error(
      `[a2a-serve] WARNING: serving WITHOUT an auth token (AOS_A2A_AUTH_TOKEN unset) — ` +
        `message/send is unauthenticated on ${cfg.bindHost}:${cfg.port}.`,
    );
  }
  return Bun.serve({
    port: cfg.port,
    hostname: cfg.bindHost,
    idleTimeout: 30,
    fetch: (req) => handleRequest(req, { wakeToken: "", dispatch: () => {}, a2a }),
  });
}

interface SkillInvoker {
  invokeSkill(
    handle: AgentHandle,
    skillId: string,
    input: { args?: string; context?: Record<string, string> },
    opts?: { signal?: AbortSignal },
  ): Promise<SkillResult>;
}

/**
 * Adapt a WARM workflow + agent handle into a SkillRunner. Reusing one warm
 * workflow/handle across requests is the performance path; a skill with an
 * mcp_binding resolves to a native MCP tool call here (no LLM round-trip).
 */
export function skillRunnerFromWorkflow(workflow: SkillInvoker, handle: AgentHandle): SkillRunner {
  return async (skill, input) => {
    const res = await workflow.invokeSkill(
      handle,
      skill.aosSkill ?? skill.id,
      {
        args: input.text,
        context: { contextId: input.contextId, taskId: input.taskId },
      },
      { signal: input.signal },
    );
    return res.success ? res.output : `error: ${res.error ?? "skill failed"}`;
  };
}

// ── Live deployment wiring (import.meta.main) ────────────────────
// Builds a warm runtime (vendor adapter + BaseWorkflow with the MCP toolset
// manager + one spawned worker agent) and serves. Untested here (needs a vendor
// CLI + a worker agent); the testable pieces above are exercised by tests.

/**
 * Live deployment wiring: build a WARM runtime (vendor adapter + BaseWorkflow
 * with the MCP toolset manager + one spawned worker agent) and serve the
 * project's skills over A2A. Reads AOS_A2A_* env (set by the `aos serve`
 * command from its flags). Untested here — needs a vendor CLI + a worker agent.
 */
export async function runA2aServe(projectRoot: string): Promise<ReturnType<typeof Bun.serve>> {
  const platform = process.env.AOS_A2A_ADAPTER ?? "claude-code";
  const workerId = process.env.AOS_A2A_WORKER_AGENT ?? "arbiter";

  // Defense-in-depth: the adapter name flows into a dynamic import() of the
  // adapter's index.ts (its module side effects run). Constrain it to known
  // adapters / a safe charset so a poisoned env var can't load arbitrary code.
  const KNOWN_ADAPTERS = new Set(["claude-code", "gemini", "codex", "pi"]);
  if (!/^[a-z0-9-]+$/.test(platform) || !KNOWN_ADAPTERS.has(platform)) {
    throw new Error(`a2a serve: unknown adapter "${platform}" (expected one of: ${[...KNOWN_ADAPTERS].join(", ")})`);
  }

  const { getAdapterDir } = await import("../utils");
  const { BaseEventBus, BaseWorkflow, CompositeRuntime } = await import("@aos-harness/adapter-shared");
  const { createSessionMcpManager } = await import("../mcp-session");

  const adapterDir = getAdapterDir(platform);
  if (!adapterDir) throw new Error(`a2a serve: adapter "${platform}" not installed`);
  const mod: any = await import(pathToFileURL(join(adapterDir, "src", "index.ts")).href);
  const RuntimeClass = mod[Object.keys(mod).find((k) => /AgentRuntime$/.test(k))!];

  const eventBus = new BaseEventBus();
  const rawRuntime = new (RuntimeClass as any)(eventBus, {}, {});
  const runtime = new CompositeRuntime(rawRuntime);
  const mcpManager = await createSessionMcpManager(projectRoot, (m) => console.error(m));
  const workflow = new BaseWorkflow(runtime, projectRoot, { mcpToolsetManager: mcpManager ?? undefined });

  const workerConfig = loadAgent(join(projectRoot, "core", "agents", workerId));
  const handle = await runtime.spawnAgent(workerConfig, `a2a-serve-${workerId}`);

  const cfg = loadA2aServeConfig(projectRoot);
  const server = startA2aServe(cfg, skillRunnerFromWorkflow(workflow, handle));
  console.error(
    `[a2a-serve] ${cfg.cardName} on :${server.port} — ${cfg.skills.length} skill(s): ${cfg.skills.map((s) => s.id).join(", ")}`,
  );
  return server;
}

if (import.meta.main) {
  await runA2aServe(process.argv[2] ?? process.cwd());
}
