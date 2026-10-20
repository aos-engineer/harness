import { beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { logHookError } from "../../src/hooks/report.ts";
import { writeArtifact } from "../../src/store/artifacts.ts";
import { aosDir, runPaths } from "../../src/store/paths.ts";
import { bindSession } from "../../src/store/sessions.ts";
import { appendEvents, createRun } from "../../src/store/store.ts";
import type { RunLocation } from "../../src/types.ts";
import { UnsafePathError } from "../../src/util/errors.ts";
import { tmpDir } from "../helpers.ts";
import { startedDraft, worktreeDraft } from "./fixtures.ts";
import { testProjector } from "./test-projector.ts";

// A process the hooks never see can replace anything under .aos with a link. Following one would write the
// kernel's bytes into the link's target, so every write path refuses instead and leaves the target alone.
let root: string;
let outside: string;
let loc: RunLocation;

beforeEach(() => {
  root = tmpDir("aos-links-");
  outside = tmpDir("aos-links-target-");
  loc = { root, run: "01JRUN0000000000000000000A" };
});

const VICTIM = "do not touch\n";

function victim(name = "victim.txt"): string {
  const path = join(outside, name);
  writeFileSync(path, VICTIM);
  return path;
}

describe("writes under .aos refuse symlinks", () => {
  test("a log.jsonl replaced by a link is never appended to", () => {
    createRun(loc, startedDraft(), testProjector);
    const target = victim();
    rmSync(runPaths(loc).log);
    symlinkSync(target, runPaths(loc).log);
    expect(() => appendEvents(loc, [worktreeDraft()], testProjector)).toThrow(UnsafePathError);
    expect(readFileSync(target, "utf8")).toBe(VICTIM);
  });

  test("a run directory replaced by a link gets no lock and no events", () => {
    createRun(loc, startedDraft(), testProjector);
    const moved = join(outside, "run");
    renameSync(runPaths(loc).dir, moved);
    symlinkSync(moved, runPaths(loc).dir);
    const before = readFileSync(join(moved, "log.jsonl"), "utf8");
    expect(() => appendEvents(loc, [worktreeDraft()], testProjector)).toThrow(UnsafePathError);
    expect(readFileSync(join(moved, "log.jsonl"), "utf8")).toBe(before);
  });

  test("a .aos that is itself a link gets no new run", () => {
    symlinkSync(outside, aosDir(root));
    expect(() => createRun(loc, startedDraft(), testProjector)).toThrow(UnsafePathError);
    expect(() => readFileSync(join(outside, "runs", loc.run, "log.jsonl"))).toThrow();
  });

  test("the message names the link and says what to do", () => {
    symlinkSync(outside, aosDir(root));
    expect(() => createRun(loc, startedDraft(), testProjector)).toThrow("AOS refuses to write through the symlink .aos; remove it and rerun");
  });

  test("an artifacts directory replaced by a link gets no artifact", () => {
    createRun(loc, startedDraft(), testProjector);
    mkdirSync(join(outside, "artifacts"));
    symlinkSync(join(outside, "artifacts"), runPaths(loc).artifacts);
    expect(() => writeArtifact(loc, "torn bytes")).toThrow(UnsafePathError);
  });

  test("a sessions directory replaced by a link gets no binding", () => {
    mkdirSync(aosDir(root));
    symlinkSync(outside, join(aosDir(root), "sessions"));
    expect(() => bindSession(root, "claude-code", "s1", loc.run)).toThrow(UnsafePathError);
  });

  test("a hook-errors.log replaced by a link is never appended to", () => {
    mkdirSync(aosDir(root));
    const target = victim();
    symlinkSync(target, join(aosDir(root), "hook-errors.log"));
    logHookError(root, "PreToolUse", new Error("boom"));
    expect(readFileSync(target, "utf8")).toBe(VICTIM);
  });

  test("ordinary runs are unaffected", () => {
    createRun(loc, startedDraft(), testProjector);
    expect(appendEvents(loc, [worktreeDraft()], testProjector).file.seq).toBe(2);
    expect(writeArtifact(loc, "bytes")).toStartWith("sha256:");
    expect(bindSession(root, "claude-code", "s1", loc.run).run).toBe(loc.run);
  });
});
