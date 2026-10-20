import { join } from "node:path";
import type { RunLocation } from "../types.ts";
import { RunNotFoundError } from "../util/errors.ts";

// Run ids reach the store from agent input (MCP tool arguments), so they are checked before they become
// paths. Kernel-issued ids are ULIDs, which always pass.
const RUN_ID = /^[A-Za-z0-9_-]+$/;

// <root>/.aos
export function aosDir(root: string): string {
  return join(root, ".aos");
}

export function runPaths(loc: RunLocation): { dir: string; log: string; state: string; lock: string; artifacts: string } {
  if (!RUN_ID.test(loc.run)) throw new RunNotFoundError(`invalid run id ${JSON.stringify(loc.run)}`);
  const dir = join(aosDir(loc.root), "runs", loc.run);
  return {
    dir,
    log: join(dir, "log.jsonl"),
    state: join(dir, "state.json"),
    lock: join(dir, "log.lock"),
    artifacts: join(dir, "artifacts"),
  };
}
