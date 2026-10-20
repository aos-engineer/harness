import { beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { appendEvents, cancelRun, humanActor, projector, runPaths } from "@aos-harness/kernel";
import type { RunLocation } from "@aos-harness/kernel";
import { doctorCommand, versionAtLeast } from "../src/commands/doctor.ts";
import { tmpDir, tmpGitRepo, writeFile } from "../../kernel/tests/helpers.ts";
import { appendRawBytes, mutateLine, replaceLine } from "../../kernel/tests/store/fixtures.ts";
import { fakeIO } from "./fake-io.ts";
import { newRun, PACK, PACK_DIR, request } from "./fixtures.ts";

let repo: string;
let loc: RunLocation;
let cache: string;

/** A plugin cache laid out the way Claude Code stores installed plugins: <marketplace>/<plugin>/<version>/skills/<skill>/. */
function pluginCache(skills: string[]): string {
  const dir = join(tmpDir("aos-plugins-"), "cache");
  for (const bind of skills) {
    const [plugin, skill] = bind.split(":");
    writeFile(dir, `claude-plugins-official/${plugin}/7.0.0/skills/${skill}/SKILL.md`, `# ${skill}\n`);
  }
  return dir;
}

const BOUND = [...new Set(Object.values(PACK.tiers).flatMap((t) => t?.stages.flatMap((s) => s.bind) ?? []))];

function doctor(o: { argv?: string[]; cwd?: string; env?: Record<string, string | undefined> } = {}) {
  return fakeIO({ argv: o.argv ?? ["doctor", "--pack", PACK_DIR], cwd: o.cwd ?? repo, env: { AOS_DOCTOR_PLUGIN_CACHE: cache, ...o.env } });
}

function unignoreAos(root: string): void {
  rmSync(join(root, ".gitignore"));
}

beforeEach(() => {
  repo = tmpGitRepo();
  writeFile(repo, ".gitignore", ".aos/\n");
  loc = newRun(repo, { git: true });
  request(loc);
  cache = pluginCache(BOUND);
});

describe("aos doctor", () => {
  test("healthy repo passes with no warnings", async () => {
    const io = doctor();
    expect(await doctorCommand(io)).toBe(0);
    expect(io.stdout).not.toMatch(/^(WARN|FAIL)/m);
    expect(io.stdout).toMatch(/^OK +bun /m);
    expect(io.stdout).toMatch(/^OK +git /m);
    expect(io.stdout).toContain(`feature-delivery@${PACK.version}`);
    expect(io.stdout).toContain(`run ${loc.run}`);
  });

  test("a hand-edited state.json is a WARN, since no reader trusts its contents", async () => {
    const path = runPaths(loc).state;
    const file = JSON.parse(readFileSync(path, "utf8")) as { state: { status: string } };
    file.state.status = "completed";
    writeFileSync(path, JSON.stringify(file));
    const io = doctor();
    expect(await doctorCommand(io)).toBe(0);
    expect(io.stdout).toMatch(/^WARN +run .*state\.json does not match what the log replays to/m);
  });

  test("a tampered log is a FAIL", async () => {
    mutateLine(loc, 0);
    const io = doctor();
    expect(await doctorCommand(io)).toBe(1);
    expect(io.stdout).toMatch(/FAIL .*tampered or corrupt at seq 2/);
  });

  test("a tampered active run stays a FAIL, and the fix says how to retire it", async () => {
    mutateLine(loc, 0);
    const io = doctor();
    expect(await doctorCommand(io)).toBe(1);
    expect(io.stdout).toMatch(new RegExp(`^FAIL run ${loc.run}: .*tampered.*aos run cancel ${loc.run}.*move .aos/runs/${loc.run} out of .aos/runs`, "m"));
  });

  // An ended run enforces nothing, so an old tampered one must not hold doctor at exit 1 forever.
  test("a tampered cancelled run is a WARN that says to inspect and retire it", async () => {
    cancelRun(loc, { actor: humanActor(), reason: "done with it" });
    mutateLine(loc, 0);
    const io = doctor();
    expect(await doctorCommand(io)).toBe(0);
    expect(io.stdout).toMatch(new RegExp(`^WARN run ${loc.run}: .*tampered.*inspect .*log\\.jsonl.*move .aos/runs/${loc.run} out of .aos/runs`, "m"));
  });

  test("a tampered completed run is a WARN even when its snapshot is gone", async () => {
    const KERNEL = { kind: "kernel" as const, id: "aos", agent: null };
    appendEvents(loc, [{ type: "run.completed", actor: KERNEL, data: { stage: "design" } }], projector);
    mutateLine(loc, 0);
    rmSync(runPaths(loc).state);
    const io = doctor();
    expect(await doctorCommand(io)).toBe(0);
    expect(io.stdout).toMatch(new RegExp(`^WARN run ${loc.run}: .*tampered`, "m"));
  });

  // The chain check quotes the bad seq value from the log; JSON.stringify leaves bidi characters as they are.
  test("text read from the log is shown with invisible characters escaped", async () => {
    replaceLine(loc, 1, JSON.stringify({ seq: "\u202e2", prev: "x" }));
    const io = doctor();
    await doctorCommand(io);
    expect(io.stdout).not.toMatch(/[\p{Cf}\u2028\u2029]/u);
    expect(io.stdout).toContain("\\u202e2");
  });

  test("a torn log tail is a WARN, since the next append repairs it", async () => {
    appendRawBytes(loc, '{"v":1,"seq":3');
    const io = doctor();
    expect(await doctorCommand(io)).toBe(0);
    expect(io.stdout).toMatch(/^WARN .*torn bytes/m);
  });

  test("a snapshot behind the log is a WARN", async () => {
    const saved = join(tmpDir(), "state.json");
    copyFileSync(runPaths(loc).state, saved);
    request(loc);
    copyFileSync(saved, runPaths(loc).state);
    const io = doctor();
    expect(await doctorCommand(io)).toBe(0);
    expect(io.stdout).toMatch(/^WARN .*state\.json is at seq 2 but the log is at seq 3.*rebuilt on the next append/m);
  });

  test("missing .gitignore entry is a WARN, not a FAIL", async () => {
    unignoreAos(repo);
    const io = doctor();
    expect(await doctorCommand(io)).toBe(0);
    expect(io.stdout).toMatch(/^WARN .*\.aos\/.*gitignore/m);
  });

  test("outside a git repository is a WARN about weak freshness", async () => {
    const plain = tmpDir("aos-plain-");
    newRun(plain);
    const io = doctor({ cwd: plain });
    expect(await doctorCommand(io)).toBe(0);
    expect(io.stdout).toMatch(/^WARN .*not inside a git repository.*weak edit counter/m);
  });

  test("hook errors are surfaced, last 3 lines only", async () => {
    writeFile(repo, ".aos/hook-errors.log", ["one", "two", "three", "four", "x pre-tool boom"].join("\n") + "\n");
    const io = doctor();
    expect(await doctorCommand(io)).toBe(0);
    expect(io.stdout).toMatch(/^WARN .*hook-errors\.log/m);
    expect(io.stdout).toContain("boom");
    expect(io.stdout).toContain("three");
    expect(io.stdout).not.toContain("two");
  });

  test("an empty hook error log is fine", async () => {
    writeFile(repo, ".aos/hook-errors.log", "");
    const io = doctor();
    await doctorCommand(io);
    expect(io.stdout).not.toContain("hook-errors.log");
  });

  test("a pack that does not load is a FAIL listing its issues", async () => {
    const bad = tmpDir("aos-bad-pack-");
    writeFile(bad, "pack.yaml", "name: broken\n");
    const io = doctor({ argv: ["doctor", "--pack", bad] });
    expect(await doctorCommand(io)).toBe(1);
    expect(io.stdout).toMatch(/^FAIL .*pack/m);
    expect(io.stdout).toContain("must have required property 'version'");
  });

  test("--pack resolves against the working directory", async () => {
    writeFile(repo, "packs/broken/pack.yaml", "name: broken\n");
    const io = doctor({ argv: ["doctor", "--pack", "packs/broken"] });
    expect(await doctorCommand(io)).toBe(1);
    expect(io.stdout).toContain(join(repo, "packs/broken"));
  });

  test("AOS_PACK chooses the pack when --pack is absent", async () => {
    const bad = tmpDir("aos-bad-pack-");
    writeFile(bad, "pack.yaml", "name: broken\n");
    const io = doctor({ argv: ["doctor"], env: { AOS_PACK: bad } });
    expect(await doctorCommand(io)).toBe(1);
    expect(io.stdout).toContain(bad);
  });

  test("without --pack or AOS_PACK it checks the reference pack shipped beside the cli", async () => {
    const io = doctor({ argv: ["doctor"] });
    expect(await doctorCommand(io)).toBe(0);
    expect(io.stdout).toContain(`feature-delivery@${PACK.version}`);
  });

  test("Claude Code older than 2.1.295 is a WARN explaining what fails open", async () => {
    const io = doctor({ env: { AOS_DOCTOR_CLAUDE_VERSION: "2.1.200 (Claude Code)" } });
    expect(await doctorCommand(io)).toBe(0);
    expect(io.stdout).toMatch(/^WARN .*2\.1\.200.*onFailure.*fail closed on push/m);
  });

  test("Claude Code not installed is a WARN", async () => {
    const io = doctor({ env: { AOS_DOCTOR_CLAUDE_VERSION: "" } });
    expect(await doctorCommand(io)).toBe(0);
    expect(io.stdout).toMatch(/^WARN .*Claude Code/m);
  });

  test("a bound skill that is not installed is a WARN naming the fallback", async () => {
    cache = pluginCache(BOUND.filter((b) => b !== "superpowers:brainstorming"));
    const io = doctor();
    expect(await doctorCommand(io)).toBe(0);
    expect(io.stdout).toMatch(/^WARN .*superpowers:brainstorming.*inline instructions/m);
    expect(io.stdout).not.toMatch(/^WARN .*superpowers:test-driven-development/m);
  });

  test("a corrupt session binding is a WARN", async () => {
    writeFile(repo, ".aos/sessions/claude-code-S1-abc.json", "{not json");
    const io = doctor();
    expect(await doctorCommand(io)).toBe(0);
    expect(io.stdout).toMatch(/^WARN .*claude-code-S1-abc\.json/m);
  });

  // A check that cannot read what it needs reports that and lets the rest of the report run.
  for (const dir of ["runs", "sessions"]) {
    test(`an unreadable .aos/${dir} is one FAIL line, and the report still finishes`, async () => {
      const path = join(repo, ".aos", dir);
      mkdirSync(path, { recursive: true });
      chmodSync(path, 0o000);
      try {
        const io = doctor();
        expect(await doctorCommand(io)).toBe(1);
        expect(io.stdout).toMatch(new RegExp(`^FAIL could not list .aos/${dir} \\(.*EACCES`, "m"));
        expect(io.stdout).toMatch(/^OK +no hook errors logged$/m);
        expect(io.stdout).toMatch(/^\d+ FAIL, \d+ WARN, \d+ OK\.$/m);
      } finally {
        chmodSync(path, 0o755);
      }
    });
  }

  test("a hook error log that cannot be read is a WARN, not a clean bill", async () => {
    mkdirSync(join(repo, ".aos", "hook-errors.log"), { recursive: true });
    const io = doctor();
    expect(await doctorCommand(io)).toBe(0);
    expect(io.stdout).toMatch(/^WARN could not read .aos\/hook-errors\.log/m);
  });

  // Doctor reports damage; repairing it belongs to writers holding the run lock.
  test("leaves log.jsonl and state.json byte-identical, even when a writer would repair them", async () => {
    const saved = join(tmpDir(), "state.json");
    copyFileSync(runPaths(loc).state, saved);
    request(loc);
    copyFileSync(saved, runPaths(loc).state); // a lagging snapshot
    appendRawBytes(loc, '{"v":1,"seq":4'); // a torn tail
    const files = () => [runPaths(loc).log, runPaths(loc).state].map((f) => readFileSync(f));
    const before = files();
    await doctorCommand(doctor());
    const after = files();
    expect(after.map((b, i) => b.equals(before[i]))).toEqual([true, true]);
  });

  test("an unknown flag is a usage error", async () => {
    expect(await doctorCommand(doctor({ argv: ["doctor", "--deny"] }))).toBe(2);
  });
});

describe("versionAtLeast", () => {
  test("compares numerically, part by part", () => {
    expect(versionAtLeast("1.3.11", "1.3.11")).toBe(true);
    expect(versionAtLeast("1.4.0", "1.3.11")).toBe(true);
    expect(versionAtLeast("1.3.9", "1.3.11")).toBe(false);
    expect(versionAtLeast("2.1.295", "2.1.295")).toBe(true);
    expect(versionAtLeast("2.10.0", "2.9.999")).toBe(true);
    expect(versionAtLeast("1.3.11-canary.4", "1.3.11")).toBe(true);
  });
});
