import { test, expect, describe, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPairSync } from "node:crypto";
import {
  startA2aServe,
  loadA2aServeConfig,
  loadExposedSkills,
  skillRunnerFromWorkflow,
} from "../cli/src/serve/a2a-serve";
import { A2aClient } from "../runtime/src/a2a-client";
import { MeshEgressPolicy } from "../runtime/src/egress-policy";
import { a2aToAgentResponse } from "../runtime/src/task-mapper";
import { verifyAgentCard } from "../runtime/src/agent-card-signer";
import type { A2aExposedSkill, SkillRunner } from "../runtime/src/a2a-skill-router";

const servers: Array<{ stop: () => void }> = [];
const dirs: string[] = [];
afterEach(() => {
  for (const s of servers) s.stop();
  servers.length = 0;
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs.length = 0;
});

function projectWithSkills(): string {
  const root = mkdtempSync(join(tmpdir(), "aos-serve-"));
  dirs.push(root);
  for (const id of ["summarize", "review"]) {
    const d = join(root, "core", "skills", id);
    mkdirSync(d, { recursive: true });
    writeFileSync(
      join(d, "skill.yaml"),
      JSON.stringify({ schema: "aos/skill/v1", id, name: id, description: id, version: "1.0.0", input: {}, output: {} }),
    );
  }
  return root;
}

function client(): A2aClient {
  return new A2aClient({ egress: new MeshEgressPolicy({ allowPrivate: true }), pollIntervalMs: 1, sleep: async () => {} });
}

describe("a2a-serve (skill-routed ingress)", () => {
  test("loadExposedSkills derives skills from core/skills/", () => {
    const root = projectWithSkills();
    expect(loadExposedSkills(root).map((s) => s.id).sort()).toEqual(["review", "summarize"]);
  });

  test("skillRunnerFromWorkflow maps invokeSkill output (honors aosSkill)", async () => {
    const workflow = {
      invokeSkill: async (_h: unknown, skillId: string, input: { args?: string }) => ({
        success: true,
        output: `ran ${skillId}:${input.args}`,
      }),
    };
    const runner = skillRunnerFromWorkflow(workflow as any, { id: "w", agentId: "w", sessionId: "s" });
    const out = await runner(
      { id: "review", name: "R", aosSkill: "code-review" },
      { text: "go", contextId: "c", taskId: "t" },
    );
    expect(out).toBe("ran code-review:go");
  });

  test("the served Agent Card advertises the project's skills with tags", async () => {
    const skills = loadExposedSkills(projectWithSkills());
    const noop: SkillRunner = async () => "";
    const server = startA2aServe({ port: 0, cardName: "aos-deployment", endpointUrl: "http://x/a2a", skills }, noop);
    servers.push({ stop: () => server.stop(true) });
    const card: any = await (await fetch(`http://localhost:${server.port}/.well-known/agent-card.json`)).json();
    expect(card.name).toBe("aos-deployment");
    expect(card.skills.map((s: any) => s.id).sort()).toEqual(["review", "summarize"]);
    expect(Array.isArray(card.skills[0].tags)).toBe(true); // AgentSkill.tags present
  });

  test("end-to-end: an A2A client routes to a skill and gets its output", async () => {
    const skills: A2aExposedSkill[] = loadExposedSkills(projectWithSkills());
    const seen: string[] = [];
    const runSkill: SkillRunner = async (skill, input) => {
      seen.push(skill.id);
      return `${skill.id}→${input.text}`;
    };
    const server = startA2aServe({ port: 0, cardName: "aos", endpointUrl: "http://x/a2a", skills }, runSkill);
    servers.push({ stop: () => server.stop(true) });

    const endpoint = `http://localhost:${server.port}/a2a`;
    const result = await client().sendMessage(endpoint, "hello", { metadata: { skillId: "review" } });
    expect(a2aToAgentResponse(result).text).toBe("review→hello");
    expect(seen).toEqual(["review"]);
  });

  test("loadA2aServeConfig loads a PEM key; fail-closed on a bad path; unset → unsigned", () => {
    const root = projectWithSkills();
    const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const keyFile = join(root, "signing-key.pem");
    writeFileSync(keyFile, privateKey.export({ type: "pkcs8", format: "pem" }) as string);

    expect(loadA2aServeConfig(root, { AOS_A2A_SIGNING_KEY: keyFile } as any).signing).toBeDefined();
    expect(loadA2aServeConfig(root, {} as any).signing).toBeUndefined();
    expect(() =>
      loadA2aServeConfig(root, { AOS_A2A_SIGNING_KEY: join(root, "nope.pem") } as any),
    ).toThrow(/not found/i);
  });

  test("loadA2aServeConfig defaults to a loopback bind (not publicly exposed)", () => {
    const root = projectWithSkills();
    expect(loadA2aServeConfig(root, {} as any).bindHost).toBe("127.0.0.1");
    expect(loadA2aServeConfig(root, { AOS_A2A_BIND: "0.0.0.0", AOS_A2A_AUTH_TOKEN: "t" } as any).bindHost).toBe("0.0.0.0");
  });

  test("loadA2aServeConfig fails closed: public bind without an auth token is refused (AUTH-003/INFRA-001)", () => {
    const root = projectWithSkills();
    // Exposing off-host with no token → throws.
    expect(() => loadA2aServeConfig(root, { AOS_A2A_BIND: "0.0.0.0" } as any)).toThrow(/AOS_A2A_AUTH_TOKEN/);
    // With a token → allowed.
    expect(loadA2aServeConfig(root, { AOS_A2A_BIND: "0.0.0.0", AOS_A2A_AUTH_TOKEN: "secret" } as any).authToken).toBe("secret");
    // Explicit anonymous opt-in → allowed (operator's conscious choice).
    expect(() => loadA2aServeConfig(root, { AOS_A2A_BIND: "0.0.0.0", AOS_A2A_ALLOW_ANON: "1" } as any)).not.toThrow();
    // Loopback default with no token → fine (not exposed).
    expect(() => loadA2aServeConfig(root, {} as any)).not.toThrow();
  });

  test("loadA2aServeConfig builds an ingress guard (env-tunable)", () => {
    const root = projectWithSkills();
    const cfg = loadA2aServeConfig(root, { AOS_A2A_RATE_PER_MIN: "1" } as any);
    expect(cfg.guard).toBeDefined();
    expect(cfg.guard!.tryAcquire().ok).toBe(true);
    expect(cfg.guard!.tryAcquire().ok).toBe(false); // 2nd request over the rate cap of 1
  });

  test("serving with a signing key yields a verifiable signed Agent Card", async () => {
    const root = projectWithSkills();
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const skills = loadExposedSkills(root);
    const noop: SkillRunner = async () => "";
    const server = startA2aServe(
      { port: 0, cardName: "aos", endpointUrl: "http://x/a2a", skills, signing: { privateKey } },
      noop,
    );
    servers.push({ stop: () => server.stop(true) });
    const card: any = await (await fetch(`http://localhost:${server.port}/.well-known/agent-card.json`)).json();
    expect(card.signatures.length).toBe(1);
    expect(verifyAgentCard(card, { trustedKeys: [publicKey] }).valid).toBe(true);
  });
});
