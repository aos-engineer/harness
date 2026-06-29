import { test, expect, describe, afterAll } from "bun:test";
import { loadRemoteAgent, discoverRemoteAgents } from "../src/config-loader";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const created: string[] = [];
function writeRA(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "aos-ra-"));
  created.push(dir);
  writeFileSync(join(dir, "remote-agent.yaml"), content);
  return dir;
}
afterAll(() => {
  for (const d of created) rmSync(d, { recursive: true, force: true });
});

describe("loadRemoteAgent (aos/remote-agent/v1)", () => {
  test("loads a valid record and fills defaults", () => {
    const dir = writeRA(
      "schema: aos/remote-agent/v1\nid: research-peer\nkind: a2a\nagent_card_url: https://peer.example.com",
    );
    const cfg = loadRemoteAgent(dir);
    expect(cfg.id).toBe("research-peer");
    expect(cfg.transport).toBe("jsonrpc");
    expect(cfg.cost).toBe("unmetered");
  });

  test("rejects the wrong schema const", () => {
    const dir = writeRA("schema: aos/agent/v1\nid: x\nkind: a2a\nagent_card_url: https://x.example.com");
    expect(() => loadRemoteAgent(dir)).toThrow(/Unknown schema/);
  });

  test("rejects a missing agent_card_url", () => {
    const dir = writeRA("schema: aos/remote-agent/v1\nid: x\nkind: a2a");
    expect(() => loadRemoteAgent(dir)).toThrow(/agent_card_url|Missing required/);
  });

  test("rejects a non-a2a kind", () => {
    const dir = writeRA("schema: aos/remote-agent/v1\nid: x\nkind: grpcthing\nagent_card_url: https://x.example.com");
    expect(() => loadRemoteAgent(dir)).toThrow();
  });
});

describe("discoverRemoteAgents", () => {
  test("returns [] when core/remote-agents is absent", () => {
    const root = mkdtempSync(join(tmpdir(), "aos-proj-"));
    created.push(root);
    expect(discoverRemoteAgents(root)).toEqual([]);
  });

  test("discovers records from subdirectories", () => {
    const root = mkdtempSync(join(tmpdir(), "aos-proj-"));
    created.push(root);
    const sub = join(root, "core", "remote-agents", "peer");
    mkdirSync(sub, { recursive: true });
    writeFileSync(
      join(sub, "remote-agent.yaml"),
      "schema: aos/remote-agent/v1\nid: peer\nkind: a2a\nagent_card_url: https://peer.example.com",
    );
    expect(discoverRemoteAgents(root).map((r) => r.id)).toEqual(["peer"]);
  });

  test("throws on duplicate remote agent ids", () => {
    const root = mkdtempSync(join(tmpdir(), "aos-proj-"));
    created.push(root);
    for (const name of ["a", "b"]) {
      const sub = join(root, "core", "remote-agents", name);
      mkdirSync(sub, { recursive: true });
      writeFileSync(
        join(sub, "remote-agent.yaml"),
        "schema: aos/remote-agent/v1\nid: dup\nkind: a2a\nagent_card_url: https://peer.example.com",
      );
    }
    expect(() => discoverRemoteAgents(root)).toThrow(/Duplicate remote agent id/);
  });
});
