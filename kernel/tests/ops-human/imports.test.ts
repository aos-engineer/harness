// The kernel refuses a non-human actor, but a caller that passes a human actor is believed. The MCP server
// and the hooks run on the agent's behalf, so they must never reach the human operations at all. This test
// reads their sources and fails if they import them.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpDir, writeFile } from "../helpers.ts";

const GUARDED = ["approve", "deny", "cancelRun", "humanActor"];
const SRC = join(import.meta.dirname, "../../src");

/** Each way `file` reaches a human operation, described in a few words; empty when it reaches none. */
function reachesHumanOps(source: string): string[] {
  const found: string[] = [];
  const specifiers = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)["'`]([^"'`]+)["'`]/g;
  for (const m of source.matchAll(specifiers)) {
    if (/(?:^|\/)ops\/human(?:\.ts)?$/.test(m[1])) found.push(`imports ${m[1]}`);
  }
  const named = /\b(?:import|export)\s+(?:type\s+)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/g;
  for (const m of source.matchAll(named)) {
    for (const part of m[1].split(",")) {
      const name = part.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0];
      if (GUARDED.includes(name)) found.push(`imports ${name} from ${m[2]}`);
    }
  }
  // A namespace import of the kernel barrel reaches every export, so look for the guarded names on it.
  const namespaces = /\bimport\s+\*\s+as\s+(\w+)\s+from\s+["']([^"']*(?:index(?:\.ts)?|@aos-harness\/kernel))["']/g;
  for (const m of source.matchAll(namespaces)) {
    for (const name of GUARDED) {
      if (new RegExp(`\\b${m[1]}\\s*\\.\\s*${name}\\b`).test(source)) found.push(`uses ${m[1]}.${name}`);
    }
  }
  return found;
}

function scan(dir: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const rel of readdirSync(dir, { recursive: true, encoding: "utf8" })) {
    if (!rel.endsWith(".ts")) continue;
    const hits = reachesHumanOps(readFileSync(join(dir, rel), "utf8"));
    if (hits.length > 0) out[rel] = hits;
  }
  return out;
}

describe("the scan itself", () => {
  test("catches each way of reaching a human operation", () => {
    const dir = tmpDir("aos-imports-");
    writeFile(dir, "direct.ts", 'import { approve } from "../ops/human.ts";\n');
    writeFile(dir, "barrel.ts", 'import { listRuns, cancelRun as stop } from "../index.ts";\n');
    writeFile(dir, "reexport.ts", 'export { humanActor } from "../index.ts";\n');
    writeFile(dir, "dynamic.ts", 'const m = await import("../ops/human.ts");\n');
    writeFile(dir, "namespace.ts", 'import * as k from "../index.ts";\nk.deny(loc, p);\n');
    writeFile(dir, "clean.ts", 'import { listRuns } from "../index.ts";\nimport type { Actor } from "../types.ts";\n');
    expect(Object.keys(scan(dir)).sort()).toEqual(["barrel.ts", "direct.ts", "dynamic.ts", "namespace.ts", "reexport.ts"]);
  });
});

describe("agent-side code never reaches human operations", () => {
  for (const area of ["mcp", "hooks"]) {
    test(`kernel/src/${area}`, () => {
      expect(scan(join(SRC, area))).toEqual({});
    });
  }
});
