import { beforeEach, describe, expect, test } from "bun:test";
import { bindSession, findBinding, loadState, projector } from "@aos-harness/kernel";
import type { RunLocation } from "@aos-harness/kernel";
import { approveCommand } from "../src/commands/approve.ts";
import { runCommand } from "../src/commands/run.ts";
import { tmpDir } from "../../kernel/tests/helpers.ts";
import { mutateLine } from "../../kernel/tests/store/fixtures.ts";
import { fakeIO } from "./fake-io.ts";
import { lastEvent, newRun, request, types } from "./fixtures.ts";

let root: string;
let run: string;
let loc: RunLocation;

beforeEach(() => {
  root = tmpDir("aos-cli-");
  loc = newRun(root);
  run = loc.run;
});

describe("aos approve", () => {
  test("without a TTY exits 2 and records nothing", async () => {
    request(loc);
    const io = fakeIO({ argv: ["approve", run], cwd: root, isTTY: false });
    expect(await approveCommand(io)).toBe(2);
    expect(io.stderr).toContain("aos approve needs an interactive terminal (TTY). Run it yourself, not through an agent.");
    expect(types(loc)).not.toContain("approval.granted");
  });

  test("wrong typed stage does not approve", async () => {
    request(loc);
    const io = fakeIO({ argv: ["approve", run], cwd: root, isTTY: true, answers: ["build"] });
    expect(await approveCommand(io)).toBe(1);
    expect(io.stderr).toContain("Not approved.");
    expect(types(loc)).not.toContain("approval.granted");
  });

  test("typed stage approves as the human", async () => {
    const id = request(loc);
    const io = fakeIO({ argv: ["approve", run], cwd: root, isTTY: true, answers: ["design"] });
    expect(await approveCommand(io)).toBe(0);
    expect(io.prompts).toEqual(['Type the stage name ("design") to approve: ']);
    expect(lastEvent(loc)).toMatchObject({ type: "approval.granted", actor: { kind: "human" }, data: { request: id, stage: "design", reason: null } });
  });

  test("shows the run, the stage, and the request summary before asking", async () => {
    request(loc, "design", "Design: a widget with two buttons.");
    const io = fakeIO({ argv: ["approve", run], cwd: root, isTTY: true, answers: ["design"] });
    await approveCommand(io);
    expect(io.stdout).toContain(run);
    expect(io.stdout).toContain("design");
    expect(io.stdout).toContain("Design: a widget with two buttons.");
  });

  test("a tampered run is never approved, and the human is not asked", async () => {
    request(loc);
    mutateLine(loc, 0);
    const io = fakeIO({ argv: ["approve", run], cwd: root, isTTY: true, answers: ["design"] });
    expect(await approveCommand(io)).toBe(1);
    expect(io.stderr).toContain("Run log is tampered or corrupt at seq 2; not approving. Run aos doctor.");
    expect(io.prompts).toEqual([]);
    expect(types(loc)).not.toContain("approval.granted");
  });

  test("--deny requires --reason", async () => {
    request(loc);
    expect(await approveCommand(fakeIO({ argv: ["approve", run, "--deny"], cwd: root, isTTY: true }))).toBe(2);
    expect(await approveCommand(fakeIO({ argv: ["approve", run, "--deny", "--reason", " "], cwd: root, isTTY: true }))).toBe(2);
    expect(types(loc)).not.toContain("approval.denied");
  });

  test("--deny with a reason denies once the stage is typed", async () => {
    const id = request(loc);
    const io = fakeIO({ argv: ["approve", run, "--deny", "--reason", "split it in two"], cwd: root, isTTY: true, answers: ["design"] });
    expect(await approveCommand(io)).toBe(0);
    expect(io.prompts).toEqual(['Type the stage name ("design") to deny: ']);
    expect(lastEvent(loc)).toMatchObject({ type: "approval.denied", actor: { kind: "human" }, data: { request: id, reason: "split it in two" } });
  });

  test("a wrong typed stage does not deny either", async () => {
    request(loc);
    const io = fakeIO({ argv: ["approve", run, "--deny", "--reason", "no"], cwd: root, isTTY: true, answers: ["nope"] });
    expect(await approveCommand(io)).toBe(1);
    expect(io.stderr).toContain("Not denied.");
    expect(types(loc)).not.toContain("approval.denied");
  });

  test("--reason is kept on an approval", async () => {
    request(loc);
    await approveCommand(fakeIO({ argv: ["approve", run, "--reason", "matches the brief"], cwd: root, isTTY: true, answers: ["design"] }));
    expect(lastEvent(loc)).toMatchObject({ type: "approval.granted", data: { reason: "matches the brief" } });
  });

  // The gate's own waiting message tells the human to run exactly this, from any directory.
  test("--root finds a run in another checkout, in the form the gate prints", async () => {
    request(loc);
    const io = fakeIO({ argv: ["approve", run, "design", "--root", root], cwd: tmpDir(), isTTY: true, answers: ["design"] });
    expect(await approveCommand(io)).toBe(0);
    expect(lastEvent(loc).type).toBe("approval.granted");
  });

  test("a stage the run is not on is refused without asking", async () => {
    request(loc);
    const io = fakeIO({ argv: ["approve", run, "build"], cwd: root, isTTY: true });
    expect(await approveCommand(io)).toBe(1);
    expect(io.stderr).toContain("is at design, not build");
    expect(io.prompts).toEqual([]);
  });

  test("nothing pending exits 1 without asking", async () => {
    const io = fakeIO({ argv: ["approve", run], cwd: root, isTTY: true });
    expect(await approveCommand(io)).toBe(1);
    expect(io.stderr).toContain("no pending approval request for design");
  });

  test("an unknown run exits 1", async () => {
    const io = fakeIO({ argv: ["approve", "01NOSUCHRUN"], cwd: root, isTTY: true });
    expect(await approveCommand(io)).toBe(1);
    expect(io.stderr).toContain("no run 01NOSUCHRUN");
  });

  // The human approves what they read. A request filed while they type must not inherit that approval.
  test("a request replaced while the human types is not approved", async () => {
    request(loc, "design", "the summary the human reads");
    let newer = "";
    let afterRace = 0;
    const io = fakeIO({
      argv: ["approve", run], cwd: root, isTTY: true,
      answers: [() => {
        newer = request(loc, "design", "a summary the human never saw");
        afterRace = types(loc).length;
        return "design";
      }],
    });
    expect(await approveCommand(io)).toBe(1);
    expect(io.stderr).toContain("Not approved");
    expect(io.stderr).toContain("no longer the pending request");
    expect(types(loc).length).toBe(afterRace); // nothing appended after the newer request
    expect(loadState(loc, projector).state.approvals.find((a) => a.request === newer)?.decision).toBeNull();
  });

  // Request text comes from the agent. Escape sequences could repaint the terminal to hide what is approved.
  test("terminal control characters in the summary are shown, not interpreted", async () => {
    request(loc, "design", "safe text\u001b[2J\u001b[Hrewritten\rover‮esrever");
    const io = fakeIO({ argv: ["approve", run], cwd: root, isTTY: true, answers: ["design"] });
    await approveCommand(io);
    expect(io.stdout).not.toMatch(/[\u001b\r‮]/);
    expect(io.stdout).toContain("\\u001b[2J");
    expect(io.stdout).toContain("\\u202e");
  });

  test("a long summary is cut at 2000 characters", async () => {
    request(loc, "design", "x".repeat(2500));
    const io = fakeIO({ argv: ["approve", run], cwd: root, isTTY: true, answers: ["design"] });
    await approveCommand(io);
    expect(io.stdout).toContain("x".repeat(2000));
    expect(io.stdout).not.toContain("x".repeat(2001));
    expect(io.stdout).toContain("500 more characters");
  });

  test("an unknown flag is a usage error", async () => {
    request(loc);
    const io = fakeIO({ argv: ["approve", run, "--yes"], cwd: root, isTTY: true });
    expect(await approveCommand(io)).toBe(2);
    expect(io.stderr).toContain("--yes");
  });

  test("--help explains that the terminal check is not a security boundary", async () => {
    const io = fakeIO({ argv: ["approve", "--help"] });
    expect(await approveCommand(io)).toBe(0);
    expect(io.stdout).toContain("not a security boundary");
  });
});

describe("aos run cancel", () => {
  test("needs the typed word", async () => {
    const io = fakeIO({ argv: ["run", "cancel", run, "--reason", "x"], cwd: root, isTTY: true, answers: ["no"] });
    expect(await runCommand(io)).toBe(1);
    expect(io.prompts).toEqual([`Type "cancel" to end run ${run}: `]);
    expect(io.stderr).toContain("Not cancelled.");
    expect(loadState(loc, projector).state.status).toBe("active");
  });

  test("ends the run and returns its sessions to pass-through", async () => {
    bindSession(root, "claude-code", "S1", run);
    const io = fakeIO({ argv: ["run", "cancel", run, "--reason", "abandoned"], cwd: root, isTTY: true, answers: ["cancel"] });
    expect(await runCommand(io)).toBe(0);
    expect(lastEvent(loc)).toMatchObject({ type: "run.cancelled", actor: { kind: "human" }, data: { reason: "abandoned" } });
    expect(findBinding(root, "claude-code", "S1")).toBeNull();
    expect(io.stdout).toContain("1 session");
  });

  test("without a TTY exits 2", async () => {
    const io = fakeIO({ argv: ["run", "cancel", run, "--reason", "x"], cwd: root, isTTY: false });
    expect(await runCommand(io)).toBe(2);
    expect(io.stderr).toContain("aos run cancel needs an interactive terminal (TTY).");
    expect(types(loc)).not.toContain("run.cancelled");
  });

  test("needs a reason", async () => {
    expect(await runCommand(fakeIO({ argv: ["run", "cancel", run], cwd: root, isTTY: true }))).toBe(2);
    expect(types(loc)).not.toContain("run.cancelled");
  });

  test("a run that already ended exits 1 without asking", async () => {
    await runCommand(fakeIO({ argv: ["run", "cancel", run, "--reason", "x"], cwd: root, isTTY: true, answers: ["cancel"] }));
    const io = fakeIO({ argv: ["run", "cancel", run, "--reason", "again"], cwd: root, isTTY: true });
    expect(await runCommand(io)).toBe(1);
    expect(io.stderr).toContain("already cancelled");
  });

  test("--root reaches a run in another checkout", async () => {
    const io = fakeIO({ argv: ["run", "cancel", run, "--reason", "x", "--root", root], cwd: tmpDir(), isTTY: true, answers: ["cancel"] });
    expect(await runCommand(io)).toBe(0);
  });

  test("other subcommands are refused", async () => {
    for (const argv of [["run", "pause", run], ["run"]]) {
      const io = fakeIO({ argv, cwd: root, isTTY: true });
      expect(await runCommand(io)).toBe(2);
      expect(io.stderr).toContain('aos run: this release supports only "cancel"');
    }
  });
});
