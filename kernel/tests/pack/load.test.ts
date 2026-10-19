import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { appendFileSync, chmodSync, cpSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadPack } from "../../src/pack/load.ts";
import { packIntegrity } from "../../src/pack/integrity.ts";
import { PackError } from "../../src/util/errors.ts";
import { tmpDir } from "../helpers.ts";

const fx = (name: string) => join(import.meta.dirname, "fixtures", name);

function copyFixture(name: string): string {
  const dir = join(tmpDir("aos-pack-"), name);
  cpSync(fx(name), dir, { recursive: true });
  return dir;
}

const appendTo = (dir: string, rel: string, text: string) => appendFileSync(join(dir, rel), text);

/** A copy of the valid fixture whose pack.yaml has one exact substring replaced. */
function validWith(from: string, to: string): string {
  const dir = copyFixture("valid");
  const path = join(dir, "pack.yaml");
  const src = readFileSync(path, "utf8");
  if (!src.includes(from)) throw new Error(`fixture edit did not apply: ${from}`);
  writeFileSync(path, src.replace(from, to));
  return dir;
}

function issuesOf(dir: string): string[] {
  try {
    loadPack(dir);
  } catch (e) {
    if (e instanceof PackError) return e.issues;
    throw e;
  }
  throw new Error("expected loadPack to reject the pack");
}

test("a valid pack resolves instructions and integrity", () => {
  const p = loadPack(fx("valid"));
  expect(Object.keys(p.instructions)).toEqual(["bounded/build"]);
  expect(p.integrity).toMatch(/^sha256:[0-9a-f]{64}$/);
});

test("defaults are filled in", () =>
  expect(loadPack(fx("valid")).tiers.bounded!.stages[0]).toMatchObject({ bind: [], model: null, gate: { tasks: "none", requires: [] } }));

for (const [fixture, issue] of [
  ["unknown-key", "additional properties"], ["unknown-role", "role \"lint\""], ["missing-instructions", "stages/bounded/build.md"],
  ["missing-tier-policy", "actions.push.policy.bounded"], ["bad-after-gate", "after_gate \"merge\""], ["bad-regex", "classify.rules[0].any[0]"],
  ["executable-file", "hooks.sh"], ["duplicate-stage", "duplicate stage \"build\""],
]) test(`rejects ${fixture}`, () => expect(() => loadPack(fx(fixture))).toThrow(expect.objectContaining({ issues: expect.arrayContaining([expect.stringContaining(issue)]) })));

test("integrity is stable and changes with any file", () => {
  const d = copyFixture("valid");
  const a = packIntegrity(d);
  expect(packIntegrity(d)).toBe(a);
  appendTo(d, "stages/bounded/build.md", "x");
  expect(packIntegrity(d)).not.toBe(a);
});

describe("loader details", () => {
  test("instruction text is the stage file's contents", () => {
    const p = loadPack(fx("valid"));
    expect(p.instructions["bounded/build"]).toBe(readFileSync(join(fx("valid"), "stages/bounded/build.md"), "utf8"));
  });

  test("the resolved pack carries the same integrity packIntegrity reports", () =>
    expect(loadPack(fx("valid")).integrity).toBe(packIntegrity(fx("valid"))));

  test("a rejection is a PackError whose message lists every issue", () => {
    let err: unknown;
    try { loadPack(fx("bad-after-gate")); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(PackError);
    for (const issue of (err as PackError).issues) expect((err as PackError).message).toContain(issue);
  });

  test("an unknown key names the key", () => expect(issuesOf(fx("unknown-key"))).toEqual([expect.stringContaining('"timeout"')]));

  test("all issues are reported at once", () => {
    const dir = validWith("gate: build }", "gate: merge }");
    writeFileSync(join(dir, "setup.ts"), "export {};\n");
    expect(issuesOf(dir)).toEqual(expect.arrayContaining([expect.stringContaining('after_gate "merge"'), expect.stringContaining("setup.ts")]));
  });

  test("an omitted requirement freshness defaults to false and match to null", () => {
    const dir = validWith("        gate: { decider: rule }\n",
      "        gate:\n          decider: rule\n          requires:\n" +
      "            - { kind: command, role: test, result: exit_zero, provenance: observed }\n" +
      "            - { kind: skill, provenance: observed }\n");
    expect(loadPack(dir).tiers.bounded!.stages[0]!.gate.requires).toEqual([
      { kind: "command", role: "test", result: "exit_zero", provenance: "observed", fresh: false },
      { kind: "skill", provenance: "observed", fresh: false, match: null },
    ]);
  });

  test("a missing pack.yaml is an issue, not a crash", () => {
    const dir = copyFixture("valid");
    const empty = join(dir, "..", "empty");
    mkdirSync(empty);
    expect(issuesOf(empty)).toEqual([expect.stringContaining("pack.yaml")]);
  });

  test("a missing pack directory is a PackError", () =>
    expect(() => loadPack(join(tmpDir(), "nope"))).toThrow(PackError));

  test("malformed YAML is an issue that keeps the parser error as its cause", () => {
    const dir = copyFixture("valid");
    writeFileSync(join(dir, "pack.yaml"), "name: [unclosed\n");
    let err: unknown;
    try { loadPack(dir); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(PackError);
    expect((err as PackError).issues).toEqual([expect.stringContaining("pack.yaml")]);
    expect((err as PackError).cause).toBeInstanceOf(Error);
  });

  test("YAML that is not a mapping is rejected", () => {
    const dir = copyFixture("valid");
    writeFileSync(join(dir, "pack.yaml"), "- just\n- a list\n");
    expect(issuesOf(dir).length).toBeGreaterThan(0);
  });

  test("YAML is parsed with the JSON schema only, so custom tags are rejected", () => {
    const dir = copyFixture("valid");
    writeFileSync(join(dir, "pack.yaml"), "name: !!js/function 'function () {}'\n");
    expect(issuesOf(dir)).toEqual([expect.stringContaining("pack.yaml")]);
  });
});

describe("semantic checks", () => {
  test("in_stages must name stages in that tier", () =>
    expect(issuesOf(validWith("stages: [build]", "stages: [build, ship]"))).toEqual([
      expect.stringMatching(/^actions\.commit\.policy\.bounded.*in_stages "ship"/),
    ]));

  test("classify.default must be a tier the pack defines", () =>
    expect(issuesOf(validWith("default: bounded", "default: spike"))).toEqual([expect.stringContaining("classify.default")]));

  test("a classify rule may propose a tier the pack does not define", () =>
    expect(() => loadPack(validWith("    - tier: bounded\n", "    - tier: architectural\n"))).not.toThrow());

  test("action patterns must compile", () =>
    expect(issuesOf(validWith("['^git\\s+commit\\b']", "['[']"))).toEqual([expect.stringContaining("actions.commit.patterns[0]")]));

  test("a policy for a tier the pack does not define is allowed when it names no stage", () =>
    expect(() => loadPack(validWith("policy: { bounded: { allow: never } }\n  deploy", "policy: { bounded: { allow: never }, spike: { allow: never } }\n  deploy"))).not.toThrow());
});

describe("schema tightening for path safety", () => {
  test("stage names cannot traverse paths", () =>
    expect(issuesOf(validWith("- name: build", "- name: ../../etc/passwd"))).toEqual(
      expect.arrayContaining([expect.stringContaining("tiers.bounded.stages[0].name")])));

  for (const prefix of ["docs/specs", "/etc/", "../outside/", "docs/../../x/"])
    test(`write prefix ${JSON.stringify(prefix)} is rejected`, () =>
      expect(issuesOf(validWith("writes: any", `writes: ["${prefix}"]`))).toEqual(
        expect.arrayContaining([expect.stringContaining("tiers.bounded.stages[0].writes")])));

  test("an empty write list and relative prefixes ending in / are accepted", () => {
    expect(loadPack(validWith("writes: any", "writes: []")).tiers.bounded!.stages[0]!.writes).toEqual([]);
    expect(loadPack(validWith("writes: any", 'writes: ["docs/specs/"]')).tiers.bounded!.stages[0]!.writes).toEqual(["docs/specs/"]);
  });

  test("every action must be declared", () =>
    expect(issuesOf(validWith("  deploy:\n    patterns: ['\\bdeploy\\b']\n    policy: { bounded: { allow: never } }\n", "")))
      .toEqual(expect.arrayContaining([expect.stringContaining("deploy")])));

  test("an unknown policy value is named plainly", () =>
    expect(issuesOf(validWith("{ allow: never } }\n  deploy", "{ allow: sometimes } }\n  deploy")))
      .toEqual([expect.stringContaining('"sometimes"')]));
});

describe("data only", () => {
  test("an executable mode bit is rejected even on markdown", () => {
    const dir = copyFixture("valid");
    chmodSync(join(dir, "stages/bounded/build.md"), 0o755);
    expect(issuesOf(dir)).toEqual([expect.stringMatching(/^stages\/bounded\/build\.md: .*executable/)]);
  });

  for (const ext of [".js", ".mjs", ".cjs", ".ts", ".sh"])
    test(`a ${ext} file is rejected`, () => {
      const dir = copyFixture("valid");
      writeFileSync(join(dir, `extra${ext}`), "");
      expect(issuesOf(dir)).toEqual([expect.stringContaining(`extra${ext}`)]);
    });

  test("a symlink is rejected, so a pack cannot pull outside files into instructions", () => {
    const dir = copyFixture("valid");
    const outside = join(tmpDir(), "secret.md");
    writeFileSync(outside, "secret\n");
    symlinkSync(outside, join(dir, "stages/bounded/linked.md"));
    expect(issuesOf(dir)).toEqual([expect.stringContaining("stages/bounded/linked.md")]);
  });

  test("node_modules and dotfiles are outside the pack", () => {
    const dir = copyFixture("valid");
    const before = packIntegrity(dir);
    mkdirSync(join(dir, "node_modules/dep"), { recursive: true });
    writeFileSync(join(dir, "node_modules/dep/index.js"), "");
    mkdirSync(join(dir, ".git/hooks"), { recursive: true });
    writeFileSync(join(dir, ".git/hooks/pre-commit.sample"), "#!/bin/sh\n", { mode: 0o755 });
    writeFileSync(join(dir, ".DS_Store"), "x");
    expect(packIntegrity(dir)).toBe(before);
    expect(() => loadPack(dir)).not.toThrow();
  });
});

describe("integrity", () => {
  test("it covers paths, not just contents", () => {
    const a = copyFixture("valid");
    const b = copyFixture("valid");
    writeFileSync(join(a, "notes-a.md"), "same\n");
    writeFileSync(join(b, "notes-b.md"), "same\n");
    expect(packIntegrity(a)).not.toBe(packIntegrity(b));
  });

  test("it does not depend on where the pack lives", () => expect(packIntegrity(copyFixture("valid"))).toBe(packIntegrity(fx("valid"))));

  test("a missing directory is a PackError", () => expect(() => packIntegrity(join(tmpDir(), "nope"))).toThrow(PackError));
});

test("loadPack works under Node", () => {
  const r = spawnSync("node", [join(import.meta.dirname, "node-load.mjs"), fx("valid")], { encoding: "utf8" });
  expect(r.stderr).toBe("");
  expect(JSON.parse(r.stdout)).toEqual({ instructions: ["bounded/build"], integrity: packIntegrity(fx("valid")) });
});
