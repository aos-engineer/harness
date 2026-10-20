/**
 * The manifests that carry the release version. The npm package, the workspace packages, and the
 * marketplace plugin must agree, or one install channel would report a version the other never shipped.
 * Both the per-PR config check and the tag check read this list, so it is kept in one place.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const VERSIONED = [
  "package.json",
  "cli/package.json",
  "kernel/package.json",
  "hosts/claude-code/package.json",
  "hosts/claude-code/.claude-plugin/plugin.json",
  "packs/feature-delivery/package.json",
];

/** The version each manifest declares, or null where the file is missing, unparsable, or has none. */
export function readVersions(root: string): Map<string, string | null> {
  const versions = new Map<string, string | null>();
  for (const file of VERSIONED) {
    try {
      const version = (JSON.parse(readFileSync(join(root, file), "utf8")) as { version?: unknown }).version;
      versions.set(file, typeof version === "string" ? version : null);
    } catch {
      versions.set(file, null);
    }
  }
  return versions;
}
