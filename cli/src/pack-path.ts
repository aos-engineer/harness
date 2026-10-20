// The reference pack ships beside the bundled CLI (cli/pack next to cli/dist) and lives in the repository's
// packs/ in a source checkout. This file sits one level below the package root in both layouts (cli/src here,
// cli/dist once bundled), so both candidates resolve from that root.
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export function defaultPackDir(): string {
  const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
  const candidates = [join(packageRoot, "pack"), join(packageRoot, "../packs/feature-delivery")];
  return candidates.find((p) => existsSync(join(p, "pack.yaml"))) ?? candidates[1]!;
}
