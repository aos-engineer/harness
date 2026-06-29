import { test, expect, describe } from "bun:test";
import { A2aSkillRouter, type A2aExposedSkill, type SkillRunner } from "../src/a2a-skill-router";

const SKILLS: A2aExposedSkill[] = [
  { id: "summarize", name: "Summarize", description: "summarize text", tags: ["nlp"] },
  { id: "review", name: "Review", description: "review code", tags: ["code"], aosSkill: "code-review" },
];

function run(captured: Array<{ skill: string; text: string }>): SkillRunner {
  return async (skill, input) => {
    captured.push({ skill: skill.aosSkill ?? skill.id, text: input.text });
    return `[${skill.id}] ${input.text}`;
  };
}

function exec(router: A2aSkillRouter, text: string, metadata?: Record<string, unknown>) {
  return router.executor()({
    text,
    message: { role: "user", parts: [{ kind: "text", text }], ...(metadata ? { metadata } : {}) },
    taskId: "t1",
    contextId: "c1",
  });
}

describe("A2aSkillRouter", () => {
  test("cardSkills always emits tags (A2A AgentSkill requires it)", () => {
    const router = new A2aSkillRouter({ skills: SKILLS, runSkill: run([]) });
    const card = router.cardSkills();
    expect(card.map((s) => s.id)).toEqual(["summarize", "review"]);
    expect(card[0]!.tags).toEqual(["nlp"]);
    // a skill declaring no tags still gets [] (not undefined)
    const r2 = new A2aSkillRouter({ skills: [{ id: "x", name: "X" }], runSkill: run([]) });
    expect(r2.cardSkills()[0]!.tags).toEqual([]);
  });

  test("metadata.skillId fast-path routes to the requested skill", async () => {
    const captured: Array<{ skill: string; text: string }> = [];
    const router = new A2aSkillRouter({ skills: SKILLS, runSkill: run(captured) });
    const res: any = await exec(router, "fix this", { skillId: "review" });
    expect(res.state).toBe("completed");
    expect(res.artifacts[0].name).toBe("review");
    expect(res.artifacts[0].parts[0].text).toBe("[review] fix this");
    expect(captured[0]!.skill).toBe("code-review"); // aosSkill mapping honored
  });

  test("falls back to the default skill when no selector is given (generic A2A client)", async () => {
    const captured: Array<{ skill: string; text: string }> = [];
    const router = new A2aSkillRouter({ skills: SKILLS, runSkill: run(captured), defaultSkillId: "summarize" });
    const res: any = await exec(router, "long text"); // no metadata → default
    expect(res.artifacts[0].name).toBe("summarize");
    expect(captured[0]!.skill).toBe("summarize");
  });

  test("defaults to the first skill when no default configured", async () => {
    const router = new A2aSkillRouter({ skills: SKILLS, runSkill: run([]) });
    const res: any = await exec(router, "x");
    expect(res.artifacts[0].name).toBe("summarize");
  });

  test("an unknown requested skill is rejected (not silently mis-routed)", async () => {
    const router = new A2aSkillRouter({ skills: SKILLS, runSkill: run([]) });
    const res: any = await exec(router, "x", { skillId: "ghost" });
    expect(res.state).toBe("rejected");
  });

  test("requires at least one skill", () => {
    expect(() => new A2aSkillRouter({ skills: [], runSkill: run([]) })).toThrow(/at least one/);
  });

  test("threads the executor abort signal into the skill runner", async () => {
    const captured: { signal?: AbortSignal } = {};
    const runSkill: SkillRunner = async (_skill, input) => {
      captured.signal = input.signal;
      return "ok";
    };
    const router = new A2aSkillRouter({ skills: SKILLS, runSkill });
    const ctrl = new AbortController();
    await router.executor()({
      text: "x",
      message: { role: "user", parts: [{ kind: "text", text: "x" }] },
      taskId: "t1",
      contextId: "c1",
      signal: ctrl.signal,
    });
    expect(captured.signal).toBe(ctrl.signal); // so a slow skill can be cancelled on the ingress deadline
  });
});
