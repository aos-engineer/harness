import { beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { bindSession, findBinding, sessionFileName, unbindRun } from "../../src/store/sessions.ts";
import { tmpDir } from "../helpers.ts";

const run = "01JRUN0000000000000000000A";
let root: string;

beforeEach(() => {
  root = tmpDir("aos-sessions-");
});

test("bindSession writes .aos/sessions/<host>-<session>-<hash>.json", () => {
  const b = bindSession(root, "claude-code", "s1", run);
  expect(b).toMatchObject({ host: "claude-code", session: "s1", run, root });
  expect(new Date(b.boundAt).toISOString()).toBe(b.boundAt);
  expect(sessionFileName("claude-code", "s1")).toMatch(/^claude-code-s1-[0-9a-f]{12}\.json$/);
  expect(JSON.parse(readFileSync(join(root, ".aos/sessions", sessionFileName("claude-code", "s1")), "utf8"))).toEqual(b);
});

test("findBinding walks up from a subdirectory", () => {
  bindSession(root, "claude-code", "s1", run);
  mkdirSync(join(root, "src/deep"), { recursive: true });
  expect(findBinding(join(root, "src/deep"), "claude-code", "s1")?.run).toBe(run);
  expect(findBinding(join(root, "src/not-created-yet"), "claude-code", "s1")?.run).toBe(run);
});

test("findBinding returns null outside any bound root", () => {
  bindSession(root, "claude-code", "s1", run);
  expect(findBinding(tmpDir(), "claude-code", "s1")).toBeNull();
});

test("findBinding returns null for another session or host", () => {
  bindSession(root, "claude-code", "s1", run);
  expect(findBinding(root, "claude-code", "s2")).toBeNull();
  expect(findBinding(root, "codex", "s1")).toBeNull();
});

test("session ids cannot escape .aos/sessions (path traversal)", () => {
  const name = sessionFileName("claude-code", "../../etc/passwd");
  expect(name).not.toMatch(/[/\\]|\.\./);
  bindSession(root, "claude-code", "../../etc/passwd", run);
  expect(readdirSync(join(root, ".aos/sessions"))).toContain(name);
  expect(readdirSync(join(root, ".aos/sessions"))).toEqual([name]);
  expect(findBinding(root, "claude-code", "../../etc/passwd")?.run).toBe(run);
});

test("sessionFileName maps unsafe characters in both parts", () => {
  expect(sessionFileName("claude-code", "abc_DEF-123")).toMatch(/^claude-code-abc_DEF-123-[0-9a-f]{12}\.json$/);
  expect(sessionFileName("a/b", "c\\d e.f")).toMatch(/^a_b-c_d_e_f-[0-9a-f]{12}\.json$/);
});

test("sessions whose readable names collide still get separate bindings", () => {
  bindSession(root, "a", "b-c", "R1");
  bindSession(root, "a-b", "c", "R2");
  bindSession(root, "claude-code", "x/y", "R3");
  bindSession(root, "claude-code", "x.y", "R4");
  expect(findBinding(root, "a", "b-c")?.run).toBe("R1");
  expect(findBinding(root, "a-b", "c")?.run).toBe("R2");
  expect(findBinding(root, "claude-code", "x/y")?.run).toBe("R3");
  expect(findBinding(root, "claude-code", "x.y")?.run).toBe("R4");
  expect(readdirSync(join(root, ".aos/sessions")).length).toBe(4);
});

test("an overlong session id still binds", () => {
  const long = "s".repeat(1000);
  bindSession(root, "claude-code", long, run);
  expect(findBinding(root, "claude-code", long)?.run).toBe(run);
  expect(Buffer.byteLength(sessionFileName("claude-code", long))).toBeLessThan(255);
});

test("rebinding a session replaces its run", () => {
  bindSession(root, "claude-code", "s1", run);
  bindSession(root, "claude-code", "s1", "R2");
  expect(findBinding(root, "claude-code", "s1")?.run).toBe("R2");
});

test("unbindRun removes every binding for the run", () => {
  bindSession(root, "claude-code", "s1", "R2");
  bindSession(root, "claude-code", "s2", "R2");
  bindSession(root, "claude-code", "s3", run);
  expect(unbindRun(root, "R2")).toBe(2);
  expect(findBinding(root, "claude-code", "s1")).toBeNull();
  expect(findBinding(root, "claude-code", "s3")?.run).toBe(run);
});

test("unbindRun skips files it cannot read and returns 0 with no sessions dir", () => {
  expect(unbindRun(root, "R2")).toBe(0);
  bindSession(root, "claude-code", "s1", "R2");
  writeFileSync(join(root, ".aos/sessions/junk.json"), "{");
  expect(unbindRun(root, "R2")).toBe(1);
  expect(existsSync(join(root, ".aos/sessions/junk.json"))).toBe(true);
});

test("findBinding fails loudly on a corrupt binding instead of reporting no run", () => {
  mkdirSync(join(root, ".aos/sessions"), { recursive: true });
  writeFileSync(join(root, ".aos/sessions", sessionFileName("claude-code", "s1")), "{");
  expect(() => findBinding(root, "claude-code", "s1")).toThrow(/binding/);
  writeFileSync(join(root, ".aos/sessions", sessionFileName("claude-code", "s1")), "");
  expect(() => findBinding(root, "claude-code", "s1")).toThrow(/binding/);
});

test("bindSession leaves no temp files behind", () => {
  bindSession(root, "claude-code", "s1", run);
  bindSession(root, "claude-code", "s1", "R2");
  expect(readdirSync(join(root, ".aos/sessions"))).toEqual([sessionFileName("claude-code", "s1")]);
});
