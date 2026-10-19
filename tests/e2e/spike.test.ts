// A spike run from start to completion through the real entry points. A spike may write and commit
// anything once its question is approved, but its code is throwaway: it can never be pushed or opened as a PR.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { verifyChain } from "@aos-harness/kernel";
import { sanitizeLog } from "../../kernel/tests/golden/sanitize.ts";
import { cleanup, scratchRepo, session, type Session } from "./harness.ts";

const BRIEF = "Spike: is it possible to fingerprint a tree without touching the index?";

const PROBE = `// Probe: write-tree from a copy of the index, so the real index is never touched.
import { execFileSync } from "node:child_process";
export const tree = () => execFileSync("git", ["write-tree"], { encoding: "utf8" }).trim();
`;

let s: Session;
let dirs: string[];

beforeEach(async () => {
  const { repo, remote } = scratchRepo({ "README.md": "# fingerprint spike\n" });
  dirs = [repo, remote];
  s = await session(repo);
});

afterEach(async () => {
  await s.close();
  cleanup(...dirs);
});

test("a spike run allows throwaway commits but never a push or a PR", async () => {
  // 1. The brief's wording proposes a spike.
  const start = await s.mcp("aos_run_start", { brief: BRIEF });
  expect(start.ok).toBe(true);
  expect(start.body).toMatchObject({ tier: "spike", stage: "frame", stages: ["frame", "probe"] });
  const runId = s.run;
  expect(s.postMcp("aos_run_start", { brief: BRIEF }, start).notice).toContain(`bound to run ${runId} (spike)`);

  // 2. Frame allows no writes until the question and probe are approved.
  expect(s.write("probe/tree.ts", PROBE).pre.deny).toContain("allows no file writes");
  const request = await s.mcp("aos_request_approval", { runId, summary: "Question: can write-tree run from a copied index? Probe: one script." });
  expect(request.ok).toBe(true);
  expect(s.stop().notice).toContain("waiting on the human");
  s.human.approve("frame");
  s.nextPrompt();
  const toProbe = await s.mcp("aos_stage_advance", { runId });
  expect(toProbe.body).toMatchObject({ advanced: true, completed: false, stage: "probe" });

  // 3. Probe writes anywhere and commits freely.
  expect(s.write("probe/tree.ts", PROBE).pre.raw).toBe("");
  expect(s.bash("git add -A").code).toBe(0);
  const commit = s.bash('git commit -qm "spike: probe write-tree from a copied index"');
  expect(commit.pre.raw).toBe("");
  expect(commit.code).toBe(0);

  // 4. Spike code never leaves the machine.
  const push = s.bash("git push origin main");
  expect(push.pre.deny).toContain("throwaway");
  expect(push.code).toBeNull();
  expect(s.bash('gh pr create --title "spike" --body "probe"').pre.deny).toContain("throwaway");

  // 5. The probe gate has no requirements, so advancing completes the run.
  const done = await s.mcp("aos_stage_advance", { runId });
  expect(done.body).toMatchObject({ advanced: true, completed: true });
  expect(verifyChain(s.loc)).toMatchObject({ ok: true, badSeq: null });
  // An empty stdout read as an allow above only if no hook crashed into its fail-open path.
  expect(s.hookErrors()).toBe("");

  if (process.env.AOS_GOLDEN_WRITE === "1") {
    writeFileSync(join(import.meta.dirname, "../../kernel/tests/golden/logs/spike.jsonl"), sanitizeLog(s.logLines(), { root: s.repo }).join("\n") + "\n");
  }
}, 60_000);
