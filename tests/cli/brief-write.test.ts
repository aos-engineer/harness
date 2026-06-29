import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, existsSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { atomicWriteBrief } from "../../cli/src/brief/write";

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), "aos-brief-"));
}

describe("atomicWriteBrief", () => {
  test("creates parent directories and writes content", async () => {
    const root = tmpDir();
    const path = join(root, "briefs", "foo", "brief.md");
    await atomicWriteBrief(path, "# Brief: x\n", { force: false });
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path, "utf-8")).toBe("# Brief: x\n");
  });

  test("throws when target exists without --force", async () => {
    const root = tmpDir();
    const path = join(root, "brief.md");
    writeFileSync(path, "old", "utf-8");
    await expect(atomicWriteBrief(path, "new", { force: false })).rejects.toThrow(/already exists/);
  });

  test("overwrites with --force", async () => {
    const root = tmpDir();
    const path = join(root, "brief.md");
    writeFileSync(path, "old", "utf-8");
    await atomicWriteBrief(path, "new", { force: true });
    expect(readFileSync(path, "utf-8")).toBe("new");
  });

  test("does not leave .tmp file when content writes successfully", async () => {
    const root = tmpDir();
    const path = join(root, "brief.md");
    await atomicWriteBrief(path, "x", { force: false });
    expect(readdirSync(root).filter((f) => f.includes(".tmp."))).toHaveLength(0);
  });
});
