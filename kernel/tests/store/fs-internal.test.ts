import { expect, test } from "bun:test";
import { join } from "node:path";
import { fsyncDir } from "../../src/store/fs-internal.ts";
import { tmpDir } from "../helpers.ts";

test("fsyncDir syncs an existing directory", () => {
  expect(() => fsyncDir(tmpDir())).not.toThrow();
});

test("fsyncDir reports a missing directory", () => {
  expect(() => fsyncDir(join(tmpDir(), "missing"))).toThrow(/ENOENT/);
});
