import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadPack } from "../../src/pack/load.ts";
import type { ActionName } from "../../src/types.ts";

// Resolved from this file, not the working directory, so the test runs from any checkout path.
const REFERENCE = join(import.meta.dirname, "../../../packs/feature-delivery");
const pack = () => loadPack(REFERENCE);

test("reference pack loads with spike and bounded tiers", () => {
  const p = pack();
  expect(p.tiers.spike!.stages.map(s => s.name)).toEqual(["frame", "probe"]);
  expect(p.tiers.bounded!.stages.map(s => s.name)).toEqual(["design", "build", "verify"]);
  expect(Object.keys(p.instructions).sort()).toEqual(["bounded/build", "bounded/design", "bounded/verify", "spike/frame", "spike/probe"]);
});

test("spike frame allows no writes; design is limited to docs/specs/", () => {
  const p = pack();
  expect(p.tiers.spike!.stages[0].writes).toEqual([]); expect(p.tiers.bounded!.stages[0].writes).toEqual(["docs/specs/"]);
});

test("binds only public superpowers skills", () => {
  const binds = Object.values(pack().tiers).flatMap(t => t!.stages.flatMap(s => s.bind));
  for (const b of binds) expect(b).toMatch(/^superpowers:(brainstorming|writing-plans|test-driven-development|verification-before-completion|requesting-code-review)$/);
});

test("probe, build, and verify write anywhere", () => {
  const p = pack();
  expect([p.tiers.spike!.stages[1]!, ...p.tiers.bounded!.stages.slice(1)].map(s => s.writes)).toEqual(["any", "any", "any"]);
});

test("action policies: commit from build, push and PR after verify, no PR from a spike, never deploy", () => {
  const { actions } = pack();
  expect(actions.commit.policy).toEqual({ spike: { allow: "always" }, bounded: { allow: "in_stages", stages: ["build", "verify"] } });
  expect(actions.push.policy).toEqual({ spike: { allow: "never" }, bounded: { allow: "after_gate", gate: "verify" } });
  expect(actions.pr_create.policy).toEqual({ spike: { allow: "never" }, bounded: { allow: "after_gate", gate: "verify" } });
  expect(actions.deploy.policy).toEqual({ spike: { allow: "never" }, bounded: { allow: "never" } });
});

test("human gates on frame and design; build needs every task and an observed fresh test run", () => {
  const p = pack();
  expect(p.tiers.spike!.stages.map(s => s.gate.decider)).toEqual(["human", "rule"]);
  expect(p.tiers.bounded!.stages.map(s => s.gate.decider)).toEqual(["human", "rule", "rule"]);
  expect(p.tiers.bounded!.stages[1]!.gate).toEqual({
    decider: "rule", tasks: "all",
    requires: [{ kind: "command", role: "test", result: "exit_zero", provenance: "observed", fresh: true }],
  });
});

test("verify needs an observed fresh test run and a fresh approved review", () =>
  expect(pack().tiers.bounded!.stages[2]!.gate.requires).toEqual([
    { kind: "command", role: "test", result: "exit_zero", provenance: "observed", fresh: true },
    { kind: "review", status: "approved", provenance: "claimed", fresh: true },
  ]));

test("model hints: reasoning to frame, design, and verify; fast to probe and build", () => {
  const p = pack();
  expect([...p.tiers.spike!.stages, ...p.tiers.bounded!.stages].map(s => [s.name, s.model])).toEqual([
    ["frame", "reasoning"], ["probe", "fast"], ["design", "reasoning"], ["build", "fast"], ["verify", "reasoning"],
  ]);
});

test("the iteration budget is 20 and unmatched briefs are bounded", () => {
  const p = pack();
  expect(p.budget).toEqual({ iterations: 20 });
  expect(p.classify.default).toBe("bounded");
});

test("each stage file fits in 30 lines and names its bound skills and finishing tool", () => {
  const p = pack();
  const finish: Record<string, string> = {
    "spike/frame": "aos_request_approval", "spike/probe": "aos_stage_advance",
    "bounded/design": "aos_request_approval", "bounded/build": "aos_stage_advance", "bounded/verify": "aos_stage_advance",
  };
  for (const [tier, def] of Object.entries(p.tiers)) {
    for (const stage of def!.stages) {
      const key = `${tier}/${stage.name}`;
      const text = p.instructions[key]!;
      expect(text.trimEnd().split("\n").length).toBeLessThanOrEqual(30);
      for (const skill of stage.bind) expect(text).toContain(skill);
      expect(text).toContain(finish[key]!);
      expect(text).toContain(stage.model === "reasoning" ? "reasoning model" : "fast model");
    }
  }
});

test("the build stage tells the agent to run tests unmasked so the run can be observed", () =>
  expect(pack().instructions["bounded/build"]).toMatch(/no pipes/i));

test("the verify stage records the review as evidence", () =>
  expect(pack().instructions["bounded/verify"]).toMatch(/aos_evidence_record[\s\S]*review/));

test("the README covers what the pack enforces", () => {
  const readme = readFileSync(join(REFERENCE, "README.md"), "utf8");
  for (const term of ["spike", "bounded", "writes", "actions", "roles", "overlay"]) expect(readme).toContain(term);
});

// The shell layer applies these to each command it would run. They are anchored at the command word, so a
// quoted mention inside another command's arguments is not an invocation.
const commands: [string, ActionName | null][] = [
  ["git commit -m 'wip'", "commit"], ["git -C ../repo commit -q", "commit"], ["git --no-pager commit", "commit"],
  ["git push origin main", "push"], ["git -c core.sshCommand=ssh push", "push"],
  ["git commit -m \"explain the git push guard\"", "commit"], ["git log --grep push", null],
  ["gh pr create --fill", "pr_create"], ["gh pr view 12", null],
  ["vercel deploy --prod", "deploy"], ["kubectl apply -f k8s/", "deploy"], ["terraform apply", "deploy"],
  ["helm upgrade api ./chart", "deploy"], ["gh workflow run release.yml", "deploy"], ["terraform plan", null],
  // Global options before the subcommand must not hide it, and a subcommand's own "push" is not a push.
  ["git --git-dir .git push", "push"], ["git --git-dir=.git push", "push"], ["git --work-tree . push", "push"],
  ["git -p push", "push"], ["git --no-pager push", "push"], ["git -C ../x push origin main", "push"],
  ["git stash push", null], ["git stash push -m \"wip\"", null],
  ["git --git-dir .git commit", "commit"], ["git --work-tree . commit -m x", "commit"], ["git -p commit", "commit"],
  ["git -C ../x commit -m msg", "commit"], ["git help commit", null], ["git log --grep commit", null],
  // Only running a Dokploy CLI or script with a deploying subcommand is a deploy.
  ["python3 ~/.claude/skills/dokploy-deploy/scripts/dokploy.py deploy --compose-id X", "deploy"],
  ["dokploy redeploy", "deploy"], ["uv run scripts/dokploy.py upsert-compose --name api", "deploy"],
  ["python scripts/dokploy.py compose.redeploy --compose-id X", "deploy"],
  ["git add docker-compose.dokploy.yml", null], ["git commit -m \"fix the dokploy redeploy loop\"", "commit"],
  ["python3 scripts/dokploy.py status --compose-id X", null], ["cat docker-compose.dokploy.yml", null],
];
test.each(commands)("%s -> %p", (cmd, expected) => {
  const { actions } = pack();
  const hits = (Object.keys(actions) as ActionName[]).filter((a) => actions[a].patterns.some((p) => new RegExp(p).test(cmd)));
  expect(hits).toEqual(expected ? [expected] : []);
});

test("design tells the agent to stop and hand bigger work back to the human", () => {
  const text = pack().instructions["bounded/design"]!;
  expect(text).toMatch(/stop and tell the human/i);
  expect(text).toMatch(/do not keep going/i);
});

test.each(["spike/probe", "bounded/build", "bounded/verify"])("%s rules out human-only commands and .aos/", (key) => {
  const text = pack().instructions[key]!;
  expect(text).toContain("`aos approve`");
  expect(text).toContain("`aos run cancel`");
  expect(text).toMatch(/never read or write `\.aos\/`/i);
});

test("the README says what the budget charges and when the data-only check misfires", () => {
  const readme = readFileSync(join(REFERENCE, "README.md"), "utf8");
  expect(readme).toMatch(/blocked stop/i);
  expect(readme).toMatch(/stage retries are not charged/i);
  expect(readme).toContain("exFAT");
});
