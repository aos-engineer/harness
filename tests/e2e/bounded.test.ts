// A bounded run from start to completion, through the same entry points Claude Code uses: the MCP tools,
// the plugin's hook command, and the human's approval. Each step checks what the agent or the human would
// see at that point.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { verifyChain } from "@aos-harness/kernel";
import { sanitizeLog } from "../../kernel/tests/golden/sanitize.ts";
import { cleanup, scratchRepo, session, type Session } from "./harness.ts";

const GREET = `export function greet(name: string): string {
  return \`Hello, \${name}!\`;
}
`;

const GREET_TEST = `import { expect, test } from "bun:test";
import { greet } from "./greet.ts";

test("greets by name", () => {
  expect(greet("Ada")).toBe("Hello, Ada!");
});
`;

const VERBOSE_TEST = `${GREET_TEST}
test("--verbose says who is greeting", () => {
  expect(greet("Ada", { verbose: true })).toBe("Hello, Ada! (greeted by greet)");
});
`;

// The first attempt accepts the flag but forgets to use it, so the new test fails.
const GREET_UNFINISHED = `export function greet(name: string, _opts: { verbose?: boolean } = {}): string {
  return \`Hello, \${name}!\`;
}
`;

const GREET_VERBOSE = `export function greet(name: string, opts: { verbose?: boolean } = {}): string {
  const line = \`Hello, \${name}!\`;
  return opts.verbose === true ? \`\${line} (greeted by greet)\` : line;
}
`;

let s: Session;
let dirs: string[];

beforeEach(async () => {
  const { repo, remote } = scratchRepo({ "src/greet.ts": GREET, "src/greet.test.ts": GREET_TEST });
  dirs = [repo, remote];
  s = await session(repo);
});

afterEach(async () => {
  await s.close();
  cleanup(...dirs);
});

test("a bounded run goes from design through build and verify to completion", async () => {
  // 1. The brief has no spike or architectural signal, so the pack proposes bounded.
  const start = await s.mcp("aos_run_start", { brief: "Add a --verbose flag to the greet script" });
  expect(start.ok).toBe(true);
  expect(start.body).toMatchObject({ tier: "bounded", stage: "design", stages: ["design", "build", "verify"] });
  const runId = s.run;

  // 2. The PostToolUse for aos_run_start binds this session to the run.
  expect(s.postMcp("aos_run_start", { brief: "Add a --verbose flag to the greet script" }, start).notice).toBe(
    `AOS: this session is bound to run ${runId} (bounded). Gates apply from now on.`,
  );
  // After compaction, the run summary comes back into context.
  const compacted = s.sessionStart("compact").notice ?? "";
  expect(compacted).toContain(`AOS run ${runId} (bounded`);
  expect(compacted).toContain("Stage 1/3: design");

  // 3. Design writes only specs.
  expect(s.write("src/greet.ts", GREET_UNFINISHED).pre.deny).toContain("allows writes only under docs/specs/");
  expect(s.write("docs/specs/verbose-flag.md", "# --verbose\n\nAppend who greeted.\n").pre.raw).toBe("");

  // Advancing before approval records a pending gate and stays in design.
  const early = await s.mcp("aos_stage_advance", { runId });
  expect(early.body).toMatchObject({ advanced: false, stage: "design", gate: { verdict: "pending" } });

  // 4. Stopping before asking for approval is blocked.
  expect(s.stop().block).toContain("Approval not requested");

  // 5. Once approval is requested, only the human can act, so the agent may stop.
  const request = await s.mcp("aos_request_approval", { runId, summary: "Add an opts.verbose flag that appends who greeted." });
  expect(request.ok).toBe(true);
  const waiting = s.stop();
  expect(waiting.block).toBeNull();
  expect(waiting.notice).toContain("waiting on the human");
  // The agent cannot approve its own design through the shell.
  expect(s.bash(`aos approve ${runId} design`).pre.deny).toContain("human-only");

  // 6. The human approves from their terminal; the next prompt advances to build.
  s.human.approve("design");
  s.nextPrompt();
  const toBuild = await s.mcp("aos_stage_advance", { runId });
  expect(toBuild.body).toMatchObject({ advanced: true, completed: false, stage: "build" });

  // 7. Build writes anywhere and may commit.
  expect(s.write("src/greet.test.ts", VERBOSE_TEST).pre.raw).toBe("");
  expect(s.write("src/greet.ts", GREET_UNFINISHED).pre.raw).toBe("");
  expect(s.bash("git add -A").code).toBe(0);
  const commit = s.bash('git commit -qm "feat: accept a verbose option"');
  expect(commit.pre.raw).toBe("");
  expect(commit.code).toBe(0);

  // 8. Build needs an observed test run before the agent may stop.
  expect(s.stop().block).toContain("No observed");

  // 9. A piped test run exits 0 through tail even though the tests fail, so it is not evidence.
  const masked = s.bash("bun test 2>&1 | tail -3");
  expect(masked.code).toBe(0);
  expect(masked.post?.notice).toContain("hidden by a pipe");

  // 10. The real run fails, which blocks the stop with the exit status; fixing the code makes it pass.
  const failing = s.bash("bun test");
  expect(failing.code).toBe(1);
  expect(s.stop().block).toContain("exited 1");
  const check = await s.mcp("aos_gate_check", { runId });
  expect(check.body).toMatchObject({ gate: { stage: "build", verdict: "fail" } });
  expect(s.write("src/greet.ts", GREET_VERBOSE).pre.raw).toBe("");
  const passing = s.bash("bun test");
  expect(passing.code).toBe(0);
  expect(passing.post?.raw).toBe("");
  // Committing the tested tree leaves the evidence fresh.
  expect(s.bash('git commit -qam "feat: append who greeted when verbose"').code).toBe(0);

  // 11. The build gate passes on the observed run.
  const toVerify = await s.mcp("aos_stage_advance", { runId });
  expect(toVerify.body).toMatchObject({ advanced: true, completed: false, stage: "verify" });

  // 12. Push waits on the verify gate, which still needs a review.
  const blockedPush = s.bash("git push origin main");
  expect(blockedPush.pre.deny).toContain("verify gate pending");
  expect(blockedPush.code).toBeNull();

  // 13. With an approved review at the current tree, the push goes through.
  const review = await s.mcp("aos_evidence_record", { runId, kind: "review", status: "approved", feedback: "Flag works and is tested.", reviewer: "self-review" });
  expect(review.ok).toBe(true);
  const push = s.bash("git push origin main");
  expect(push.pre.raw).toBe("");
  expect(push.code).toBe(0);

  // 14. Verify passes, which completes the run; a completed run never blocks a stop.
  const done = await s.mcp("aos_stage_advance", { runId });
  expect(done.body).toMatchObject({ advanced: true, completed: true });
  expect(s.stop().raw).toBe("");

  // 15. The log's hash chain is intact.
  expect(verifyChain(s.loc)).toMatchObject({ ok: true, badSeq: null });

  if (process.env.AOS_GOLDEN_WRITE === "1") {
    writeFileSync(join(import.meta.dirname, "../../kernel/tests/golden/logs/bounded.jsonl"), sanitizeLog(s.logLines(), { root: s.repo }).join("\n") + "\n");
  }
}, 60_000);
