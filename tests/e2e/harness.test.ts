// The scenarios read an empty hook stdout as an allow. A hook that crashed prints nothing too: file-edit
// hooks fail open, and a kernel error allows every command that is not consequential. So each scenario
// also checks that no hook logged an error, and this proves that check sees a crash behind an allow.
import { expect, test } from "bun:test";
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, scratchRepo, session } from "./harness.ts";

test("a hook that crashes behind an allow shows up in hookErrors", async () => {
  const { repo, remote } = scratchRepo({ "README.md": "# crash\n" });
  const s = await session(repo);
  try {
    const brief = { brief: "Add a --quiet flag" };
    s.postMcp("aos_run_start", brief, await s.mcp("aos_run_start", brief));
    expect(s.write("docs/specs/quiet.md", "# quiet\n").pre.raw).toBe("");
    expect(s.hookErrors()).toBe("");

    // An unreadable binding makes every hook in this session throw before it decides anything.
    const sessions = join(repo, ".aos", "sessions");
    for (const f of readdirSync(sessions)) writeFileSync(join(sessions, f), "{");
    const crashed = s.write("docs/specs/quiet.md", "# quiet, again\n");
    expect(crashed.pre.raw).toBe("");
    expect(s.hookErrors()).toContain("pre-tool");
    expect(s.hookErrors()).toContain("unreadable session binding");
  } finally {
    await s.close();
    cleanup(repo, remote);
  }
});
