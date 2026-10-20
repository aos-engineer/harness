// The entry point's decision path in process, with the renderer swapped, so the fallback for a decision
// that fails to render can be exercised. Nothing real renders a decision its event cannot carry.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { at, bound, pass, startRun } from "../../../../kernel/tests/hooks/helpers.ts";
import { tmpGitRepo } from "../../../../kernel/tests/helpers.ts";
import { respond } from "../../bin/aos-hook.ts";
import { render } from "../../src/render.ts";
import { payload } from "./support.ts";

let repo: string;
beforeEach(() => {
  repo = tmpGitRepo();
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

/** Throws on the first render, then renders for real. */
function flakyRender(): typeof render {
  let calls = 0;
  return (event, decision) => {
    calls++;
    if (calls === 1) throw new Error("cannot render this decision");
    return render(event, decision);
  };
}

test("a push whose decision fails to render falls back to deny", () => {
  const run = startRun(repo, "bounded");
  bound(repo, run);
  at({ root: repo, run }, "verify");
  pass({ root: repo, run }); // the push itself would be allowed
  const raw = JSON.stringify(payload("pre-tool-use-bash-true", repo, { command: "git push" }));
  const out = JSON.parse(respond("pre-tool-use", raw, { render: flakyRender() })).hookSpecificOutput;
  expect(out.permissionDecision).toBe("deny");
  expect(out.permissionDecisionReason).toContain("cannot render this decision");
  expect(readFileSync(join(repo, ".aos/hook-errors.log"), "utf8")).toContain("cannot render this decision");
});

test("a harmless command whose decision fails to render passes through", () => {
  const run = startRun(repo, "bounded");
  bound(repo, run);
  const raw = JSON.stringify(payload("pre-tool-use-bash-true", repo, { command: "ls" }));
  expect(respond("pre-tool-use", raw, { render: flakyRender() })).toBe("");
});

test("an unknown event decides nothing", () => {
  expect(respond("nope", "{}")).toBe("");
});
