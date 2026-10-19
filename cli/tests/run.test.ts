// aos run cancel is the way out of a run that has gone wrong, so it must still release the sessions of a
// run whose log cannot be read or trusted. Otherwise a bound session fails closed on push with no exit.
import { beforeEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { bindSession, findBinding, runPaths } from "@aos-harness/kernel";
import type { RunLocation } from "@aos-harness/kernel";
import { doctorCommand } from "../src/commands/doctor.ts";
import { runCommand } from "../src/commands/run.ts";
import { tmpDir } from "../../kernel/tests/helpers.ts";
import { mutateLine } from "../../kernel/tests/store/fixtures.ts";
import { fakeIO } from "./fake-io.ts";
import { newRun, PACK_DIR, request, types } from "./fixtures.ts";

let root: string;
let loc: RunLocation;

beforeEach(() => {
  root = tmpDir("aos-cancel-");
  loc = newRun(root);
  request(loc);
  bindSession(root, "claude-code", "S1", loc.run);
});

function cancel(answers = ["cancel"]) {
  return fakeIO({ argv: ["run", "cancel", loc.run, "--reason", "stuck"], cwd: root, isTTY: true, answers });
}

describe("aos run cancel on a broken run", () => {
  const broken: Array<[string, () => void]> = [
    ["the last log line was edited", () => mutateLine(loc, -1)],
    ["state.json is gone and an earlier line was edited", () => { mutateLine(loc, 0); rmSync(runPaths(loc).state); }],
    ["an earlier line was edited while the snapshot still matches the end", () => mutateLine(loc, 0)],
    ["the run directory was deleted", () => rmSync(runPaths(loc).dir, { recursive: true })],
  ];

  for (const [name, breakIt] of broken) {
    test(`releases the session when ${name}`, async () => {
      breakIt();
      const io = cancel();
      expect(await runCommand(io)).toBe(0);
      expect(findBinding(root, "claude-code", "S1")).toBeNull();
      expect(io.stdout).toContain("Released 1 session");
      expect(io.stdout).toContain("could not record the cancel");
    });
  }

  test("still needs the typed word", async () => {
    mutateLine(loc, -1);
    const io = cancel(["no"]);
    expect(await runCommand(io)).toBe(1);
    expect(findBinding(root, "claude-code", "S1")?.run).toBe(loc.run);
  });

  test("still needs a terminal", async () => {
    mutateLine(loc, -1);
    const io = fakeIO({ argv: ["run", "cancel", loc.run, "--reason", "stuck"], cwd: root, isTTY: false });
    expect(await runCommand(io)).toBe(2);
    expect(findBinding(root, "claude-code", "S1")?.run).toBe(loc.run);
  });

  test("writes nothing into a log it cannot trust", async () => {
    mutateLine(loc, 0);
    await runCommand(cancel());
    expect(types(loc)).not.toContain("run.cancelled");
  });

  test("a run that does not exist and has no session is an error, not a silent success", async () => {
    const io = fakeIO({ argv: ["run", "cancel", "01NOSUCHRUN", "--reason", "x"], cwd: root, isTTY: true });
    expect(await runCommand(io)).toBe(1);
    expect(io.stderr).toContain("no run 01NOSUCHRUN");
    expect(io.prompts).toEqual([]);
  });
});

describe("aos doctor and session bindings", () => {
  const doctor = () => fakeIO({ argv: ["doctor", "--pack", PACK_DIR], cwd: root });

  test("a binding to a deleted run is a FAIL that names the cancel command", async () => {
    rmSync(runPaths(loc).dir, { recursive: true });
    const io = doctor();
    expect(await doctorCommand(io)).toBe(1);
    expect(io.stdout).toMatch(new RegExp(`^FAIL .*${loc.run}.*does not exist.*aos run cancel ${loc.run} --reason "\\.\\.\\."`, "m"));
  });

  test("a binding to a run whose log fails verification is a FAIL that names the cancel command", async () => {
    mutateLine(loc, 0);
    const io = doctor();
    expect(await doctorCommand(io)).toBe(1);
    expect(io.stdout).toMatch(new RegExp(`^FAIL session binding .*${loc.run}.*fails verification.*aos run cancel ${loc.run} --reason "\\.\\.\\."`, "m"));
  });

  test("a binding to a healthy run is not flagged", async () => {
    const io = doctor();
    expect(await doctorCommand(io)).toBe(0);
    expect(io.stdout).not.toMatch(/^(WARN|FAIL) session binding/m);
  });

  test("following the fix clears the binding failure", async () => {
    rmSync(runPaths(loc).dir, { recursive: true });
    await runCommand(cancel());
    const io = doctor();
    expect(await doctorCommand(io)).toBe(0);
    expect(io.stdout).not.toContain(loc.run);
  });
});
