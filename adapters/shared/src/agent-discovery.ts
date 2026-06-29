import { existsSync, readdirSync, readFileSync, mkdirSync, symlinkSync, rmSync } from "node:fs";
import { join, dirname, resolve } from "node:path";

/** Walk up from `cwd` looking for a directory containing `core/`. */
export function findProjectRoot(cwd: string): string | null {
  let dir = resolve(cwd);
  for (let i = 0; i < 20; i++) {
    if (existsSync(join(dir, "core"))) return dir;
    if (existsSync(join(dir, ".aos"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Recursively discover all agent directories (those containing agent.yaml).
 * Returns a Map of agentId -> absolute directory path.
 */
export function discoverAgents(agentsDir: string): Map<string, string> {
  const agents = new Map<string, string>();

  function walk(dir: string): void {
    if (!existsSync(dir)) return;
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const subDir = join(dir, entry.name);
      const yamlPath = join(subDir, "agent.yaml");
      if (existsSync(yamlPath)) {
        // Read the id from agent.yaml
        try {
          const raw = readFileSync(yamlPath, "utf-8");
          const idMatch = raw.match(/^id:\s*(.+)$/m);
          if (idMatch) {
            agents.set(idMatch[1].trim(), subDir);
          }
        } catch {
          // Skip unreadable
        }
      }
      // Recurse into subdirectories
      walk(subDir);
    }
  }

  walk(agentsDir);
  return agents;
}

/**
 * Create a flat temporary directory with symlinks so the engine can
 * resolve agent IDs via `join(agentsDir, id)`.
 */
export function createFlatAgentsDir(projectRoot: string, agentMap: Map<string, string>): string {
  const flatDir = join(projectRoot, ".aos", "_flat_agents");
  if (existsSync(flatDir)) {
    rmSync(flatDir, { recursive: true, force: true });
  }
  mkdirSync(flatDir, { recursive: true });

  for (const [id, dirPath] of agentMap) {
    const linkPath = join(flatDir, id);
    if (!existsSync(linkPath)) {
      symlinkSync(dirPath, linkPath, "dir");
    }
  }

  return flatDir;
}
