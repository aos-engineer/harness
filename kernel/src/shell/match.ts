// Classifies a Bash command for the hooks: is it a test run whose exit status can be trusted, a guarded
// action (commit, push, PR, deploy), a human-only command, or a touch of `.aos/`. Every check runs on the
// simple commands that actually execute (see leaves.ts), so a quoted mention never counts as a call.
import { ACTION_PRIORITY, type ActionDef, type ActionName } from "../types.ts";
import { walk } from "./leaves.ts";

/** The first role (in pack order) one of whose prefixes starts a leaf command, and whether its exit status is masked. */
export function matchRole(cmd: string, roles: Record<string, string[]>): { role: string; masked: boolean } | null {
  const leaves = walk(cmd).leaves;
  for (const [role, prefixes] of Object.entries(roles)) {
    for (const prefix of prefixes) {
      for (const leaf of leaves) {
        if (leaf.text === prefix || leaf.text.startsWith(prefix + " ")) {
          return { role, masked: leaf.masked };
        }
      }
    }
  }
  return null;
}

// Pack patterns are fixed for a process's lifetime, so each compiles once.
const compiled = new Map<string, RegExp>();
function pattern(source: string): RegExp {
  let re = compiled.get(source);
  if (re === undefined) {
    re = new RegExp(source);
    compiled.set(source, re);
  }
  return re;
}

/** The highest-priority action any leaf command matches, or null. */
export function matchAction(cmd: string, actions: Record<ActionName, ActionDef>): ActionName | null {
  const leaves = walk(cmd).leaves;
  for (const name of ACTION_PRIORITY) {
    const def = actions[name];
    if (def === undefined) continue;
    for (const source of def.patterns) {
      const re = pattern(source);
      if (leaves.some((leaf) => re.test(leaf.text))) return name;
    }
  }
  return null;
}

// The installed binary (bare or by path), the published package through a runner, or the CLI from source.
const HUMAN_ONLY =
  /^(?:(?:\S*\/)?aos|(?:bunx|npx)\s+aos-harness|bun\s+(?:run\s+)?\S*cli\/src\/index\.ts)\s+(approve|waive|tier\s+lower|budget\s+extend|run\s+(?:pause|cancel))\b/;

/** The human-only subcommand a leaf command invokes (for example "approve" or "run cancel"), or null. */
export function matchHumanOnly(cmd: string): string | null {
  for (const leaf of walk(cmd).leaves) {
    const m = HUMAN_ONLY.exec(leaf.text);
    if (m !== null) return m[1].replace(/\s+/g, " ");
  }
  return null;
}

const AOS_DIR = /(^|\/|>)\.aos(\/|$)/;

/** True when any word of any segment, including `cd` targets, assignments, and redirect targets, names `.aos`. */
export function mentionsAosDir(cmd: string): boolean {
  // Every segment, not just leaves: `cd .aos` and `DIR=.aos/runs` are dropped from leaves but still reach it.
  // Splitting at `<`, `>`, and `=` exposes redirect targets and assigned values glued to other text.
  for (const seg of walk(cmd).segments) {
    for (const word of seg.words) {
      if (word.value.split(/[<>=]/).some((part) => AOS_DIR.test(part))) return true;
    }
  }
  return false;
}
