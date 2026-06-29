import { dirname } from "node:path";
import { existsSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";

export interface WriteOpts {
  force: boolean;
}

export async function atomicWriteBrief(targetPath: string, content: string, opts: WriteOpts): Promise<void> {
  if (existsSync(targetPath) && !opts.force) {
    throw new Error(`Brief already exists at ${targetPath}. Pass --force to overwrite.`);
  }

  const parent = dirname(targetPath);
  try {
    mkdirSync(parent, { recursive: true });
  } catch (err: any) {
    if (err.code === "EACCES" || err.code === "EROFS") {
      throw new Error(`Cannot create directory ${parent}: permission denied. Use --out <path> to write somewhere else.`);
    }
    throw err;
  }

  const tmpPath = `${targetPath}.tmp.${process.pid}`;
  try {
    writeFileSync(tmpPath, content, "utf-8");
    renameSync(tmpPath, targetPath);
  } catch (err) {
    try {
      if (existsSync(tmpPath)) unlinkSync(tmpPath);
    } catch {
      // best-effort cleanup
    }
    throw err;
  }
}
