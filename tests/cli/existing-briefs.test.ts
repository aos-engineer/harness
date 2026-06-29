import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { validateBrief } from "../../cli/src/brief/validate";

const BRIEFS_DIR = join(import.meta.dir, "..", "..", "core", "briefs");

function findBriefs(): string[] {
  const out: string[] = [];
  if (!existsSync(BRIEFS_DIR)) return out;
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.isFile() && (entry.name === "brief.md" || /-brief\.md$/.test(entry.name))) out.push(p);
    }
  };
  walk(BRIEFS_DIR);
  return out;
}

describe("existing committed briefs validate clean", () => {
  for (const path of findBriefs()) {
    test(`${path.replace(`${BRIEFS_DIR}/`, "")} auto-detects and validates without errors`, () => {
      const r = validateBrief(readFileSync(path, "utf-8"));
      expect(r.errors).toEqual([]);
      expect(r.detectedKind).not.toBeNull();
    });
  }
});
