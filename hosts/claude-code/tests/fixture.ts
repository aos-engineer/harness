// Loads the hook payload fixtures under tests/fixtures. Each one is a Claude Code hook payload plus a
// top-level "_source": "captured" (sanitized from a real session) or "docs" (shaped from the docs).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const dir = join(import.meta.dir, "fixtures");

export function fixtureNames(): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.slice(0, -".json".length))
    .sort();
}

/** A fresh copy of a fixture, so a test can modify it without affecting others. */
export function fx(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(dir, `${name}.json`), "utf8")) as Record<string, unknown>;
}
