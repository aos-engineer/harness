// Path comparison for write tools. git reports the run root with symlinks resolved, but a payload path may
// reach the same file another way (the /tmp spelling of /private/tmp on macOS, or any symlink), so both
// sides are compared as physical paths: the place the write will actually land.
import { realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

/**
 * The realpath of the deepest existing ancestor of `path`, plus the segments below it that do not exist yet,
 * since a write usually creates its file and may create directories too.
 */
export function physicalPath(path: string): string {
  const missing: string[] = [];
  for (let dir = resolve(path); ; dir = dirname(dir)) {
    let real: string;
    try {
      real = realpathSync(dir);
    } catch {
      // Not there yet, or not a directory: try one level up and keep the name.
      if (dirname(dir) === dir) return resolve(path);
      missing.unshift(basename(dir));
      continue;
    }
    return join(real, ...missing);
  }
}

/** `path` relative to `root` with `/` separators, or null when it lands outside the root. */
export function rootRelative(root: string, path: string): string | null {
  const rel = relative(physicalPath(root), physicalPath(path)).split(sep).join("/");
  return rel === ".." || rel.startsWith("../") || isAbsolute(rel) ? null : rel;
}
