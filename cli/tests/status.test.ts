import { beforeEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { appendEvents, projector, runPaths } from "@aos-harness/kernel";
import type { Actor, RunLocation } from "@aos-harness/kernel";
import { statusCommand } from "../src/commands/status.ts";
import { tmpDir, tmpGitRepo, writeFile } from "../../kernel/tests/helpers.ts";
import { mutateLine } from "../../kernel/tests/store/fixtures.ts";
import { fakeIO } from "./fake-io.ts";
import { newRun, request } from "./fixtures.ts";

const KERNEL: Actor = { kind: "kernel", id: "aos", agent: null };

let root: string;
let loc: RunLocation;
let run: string;

beforeEach(() => {
  root = tmpDir("aos-status-");
  loc = newRun(root);
  run = loc.run;
});

describe("aos status (all runs)", () => {
  test("lists runs with status, tier, and stage", async () => {
    const io = fakeIO({ argv: ["status"], cwd: root });
    expect(await statusCommand(io)).toBe(0);
    expect(io.stdout).toContain(`${run}  active  bounded  design`);
  });

  test("lists every run, oldest id first", async () => {
    const spike = newRun(root, { tier: "spike" });
    const io = fakeIO({ argv: ["status"], cwd: root });
    await statusCommand(io);
    // Run ids have a fixed width, so sorting the lines sorts by id.
    expect(io.stdout.trim().split("\n")).toEqual([`${run}  active  bounded  design`, `${spike.run}  active  spike  frame`].sort());
  });

  test("says so when there are no runs", async () => {
    const empty = tmpDir("aos-empty-");
    const io = fakeIO({ argv: ["status"], cwd: empty });
    expect(await statusCommand(io)).toBe(0);
    expect(io.stdout).toContain(`No AOS runs under ${empty}.`);
  });

  test("a run whose log cannot be replayed is listed as unreadable, and the rest still show", async () => {
    const good = newRun(root);
    request(loc); // a second event, whose link to the first one the edit below breaks
    mutateLine(loc, 0);
    rmSync(runPaths(loc).state);
    const io = fakeIO({ argv: ["status"], cwd: root });
    expect(await statusCommand(io)).toBe(1);
    expect(io.stdout).toContain(`${good.run}  active  bounded  design`);
    expect(io.stdout).toMatch(new RegExp(`${run}  unreadable: .*Run aos doctor`));
  });

  test("--json lists runs as an array", async () => {
    const io = fakeIO({ argv: ["status", "--json"], cwd: root });
    await statusCommand(io);
    expect(JSON.parse(io.stdout)).toEqual([{ run, status: "active", tier: "bounded", stage: "design" }]);
  });

  test("finds runs at the git top level from a subdirectory", async () => {
    const repo = tmpGitRepo();
    const inRepo = newRun(repo, { git: true });
    writeFile(repo, "src/deep/file.ts", "export {};\n");
    const io = fakeIO({ argv: ["status"], cwd: join(repo, "src/deep") });
    await statusCommand(io);
    expect(io.stdout).toContain(`${inRepo.run}  active  bounded  design`);
  });
});

describe("aos status <run>", () => {
  test("summarizes one run with its gaps", async () => {
    const io = fakeIO({ argv: ["status", run], cwd: root });
    expect(await statusCommand(io)).toBe(0);
    expect(io.stdout).toContain("Stage 1/3: design");
    expect(io.stdout).toContain("Approval not requested");
  });

  test("shows a gap that waits on the human", async () => {
    request(loc);
    const io = fakeIO({ argv: ["status", run], cwd: root });
    await statusCommand(io);
    expect(io.stdout).toContain(`aos approve ${run} design`);
  });

  test("evaluates the gate against the current git tree", async () => {
    const repo = tmpGitRepo();
    const inRepo = newRun(repo, { git: true });
    const io = fakeIO({ argv: ["status", inRepo.run, "--json"], cwd: repo });
    expect(await statusCommand(io)).toBe(0);
    expect(JSON.parse(io.stdout).gate.fingerprint).toMatch(/^git:[0-9a-f]{40}$/);
  });

  test("--json is machine-readable", async () => {
    const io = fakeIO({ argv: ["status", run, "--json"], cwd: root });
    expect(await statusCommand(io)).toBe(0);
    const s = JSON.parse(io.stdout);
    expect(s).toMatchObject({ run, status: "active", tier: "bounded", stage: "design", stages: ["design", "build", "verify"], iterations: { used: 0, limit: 20 } });
    expect(s.gate).toMatchObject({ stage: "design", verdict: "pending" });
    expect(s.gate.gaps.map((g: { requirement: string }) => g.requirement)).toEqual(["approval"]);
  });

  test("a tampered log is reported, not summarized", async () => {
    request(loc);
    mutateLine(loc, 0);
    const io = fakeIO({ argv: ["status", run], cwd: root });
    expect(await statusCommand(io)).toBe(1);
    expect(io.stderr).toContain("Run log is tampered or corrupt at seq 2. Run aos doctor.");
    expect(io.stdout).toBe("");
  });

  test("an unknown run exits 1", async () => {
    const io = fakeIO({ argv: ["status", "01NOSUCHRUN"], cwd: root });
    expect(await statusCommand(io)).toBe(1);
    expect(io.stderr).toContain("no run 01NOSUCHRUN");
  });

  test("--root reads a run in another checkout", async () => {
    const io = fakeIO({ argv: ["status", run, "--root", root], cwd: tmpDir() });
    expect(await statusCommand(io)).toBe(0);
    expect(io.stdout).toContain("Stage 1/3: design");
  });

  // Task titles come from the agent; the summary goes to a human's terminal.
  test("terminal control characters in agent text are shown, not interpreted", async () => {
    appendEvents(loc, [
      { type: "stage.entered", actor: KERNEL, data: { stage: "build", index: 1 } },
      { type: "task.added", actor: { kind: "agent", id: "mcp:aos_task_add", agent: null }, data: { task: "t1", stage: "build", title: "fix\u001b[2Jit" } },
    ], projector);
    const io = fakeIO({ argv: ["status", run], cwd: root });
    await statusCommand(io);
    expect(io.stdout).not.toContain("\u001b");
    expect(io.stdout).toContain("fix\\u001b[2Jit");
  });

  test("needs no terminal, since it changes nothing", async () => {
    const io = fakeIO({ argv: ["status", run], cwd: root, isTTY: false });
    expect(await statusCommand(io)).toBe(0);
  });

  test("an unknown flag is a usage error", async () => {
    const io = fakeIO({ argv: ["status", "--deny"], cwd: root });
    expect(await statusCommand(io)).toBe(2);
  });
});
