import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, lstatSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverAgents, findProjectRoot, createFlatAgentsDir } from "../src/agent-discovery";

test("discoverAgents finds agents recursively by agent.yaml", () => {
  const root = mkdtempSync(join(tmpdir(), "discover-"));
  mkdirSync(join(root, "alice"), { recursive: true });
  writeFileSync(join(root, "alice", "agent.yaml"), "id: alice\n");
  mkdirSync(join(root, "nested", "bob"), { recursive: true });
  writeFileSync(join(root, "nested", "bob", "agent.yaml"), "id: bob\n");

  const map = discoverAgents(root);
  expect(map.get("alice")).toBe(join(root, "alice"));
  expect(map.get("bob")).toBe(join(root, "nested", "bob"));
});

test("findProjectRoot walks up to find core/ or .aos/", () => {
  const root = mkdtempSync(join(tmpdir(), "proj-"));
  mkdirSync(join(root, "core"));
  const deep = join(root, "a", "b", "c");
  mkdirSync(deep, { recursive: true });
  expect(findProjectRoot(deep)).toBe(root);
});

test("createFlatAgentsDir creates symlinks and wipes on re-call", () => {
  // Set up a projectRoot temp dir
  const projectRoot = mkdtempSync(join(tmpdir(), "flat-agents-"));

  // Create two agent dirs
  const agentAliceDir = mkdtempSync(join(tmpdir(), "agent-alice-"));
  const agentBobDir = mkdtempSync(join(tmpdir(), "agent-bob-"));

  const agentMap = new Map<string, string>([
    ["alice", agentAliceDir],
    ["bob", agentBobDir],
  ]);

  // First call
  const flatDir = createFlatAgentsDir(projectRoot, agentMap);

  // Assert returned path
  expect(flatDir).toBe(join(projectRoot, ".aos", "_flat_agents"));

  // Assert symlinks exist and resolve correctly
  const aliceLink = join(flatDir, "alice");
  const bobLink = join(flatDir, "bob");

  expect(lstatSync(aliceLink).isSymbolicLink()).toBe(true);
  expect(lstatSync(bobLink).isSymbolicLink()).toBe(true);
  expect(realpathSync(aliceLink)).toBe(realpathSync(agentAliceDir));
  expect(realpathSync(bobLink)).toBe(realpathSync(agentBobDir));

  // Second call with only bob — alice should be gone (dir wiped+recreated)
  const agentMapReduced = new Map<string, string>([["bob", agentBobDir]]);
  createFlatAgentsDir(projectRoot, agentMapReduced);

  // alice symlink from the first call must no longer exist
  expect(() => lstatSync(aliceLink)).toThrow();

  // bob symlink must still be present and valid
  expect(lstatSync(bobLink).isSymbolicLink()).toBe(true);
  expect(realpathSync(bobLink)).toBe(realpathSync(agentBobDir));
});
