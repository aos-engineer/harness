import { expect, test } from "bun:test";
import { runGit } from "../../src/tree/git.ts";
import { TreeError } from "../../src/util/errors.ts";
import { tmpDir } from "../helpers.ts";
import { fakeGitDir, withPath } from "./fake-git.ts";

test("a git that hangs past the deadline fails with a TreeError carrying the timeout", () => {
  const bin = fakeGitDir("exec sleep 5\n");
  let caught: unknown;
  const started = performance.now();
  withPath(bin, () => {
    try {
      runGit(tmpDir(), ["status"], process.env, 200);
    } catch (e) {
      caught = e;
    }
  });
  expect(performance.now() - started).toBeLessThan(2_000);
  expect(caught).toBeInstanceOf(TreeError);
  expect((caught as TreeError).cause).toMatchObject({ code: "ETIMEDOUT" });
});

test("a failing git surfaces its stderr in the TreeError", () => {
  const bin = fakeGitDir("echo 'fatal: broken' >&2\nexit 128\n");
  expect(() => withPath(bin, () => runGit(tmpDir(), ["status"]))).toThrow(/fatal: broken/);
});
