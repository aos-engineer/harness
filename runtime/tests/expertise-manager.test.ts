import { describe, it, expect, beforeEach } from "bun:test";
import { ExpertiseManager } from "../src/expertise-manager";
import type { ExpertiseFile, ExpertiseDiff } from "../src/types";

describe("ExpertiseManager.parseExpertise", () => {
  let manager: ExpertiseManager;

  beforeEach(() => {
    manager = new ExpertiseManager();
  });

  it("returns empty expertise for null input", () => {
    const result = manager.parseExpertise(null);
    expect(result.last_updated).toBe("");
    expect(result.session_count).toBe(0);
    expect(result.knowledge).toEqual({});
  });

  it("returns empty expertise for undefined input", () => {
    const result = manager.parseExpertise(undefined);
    expect(result.last_updated).toBe("");
    expect(result.session_count).toBe(0);
    expect(result.knowledge).toEqual({});
  });

  it("returns empty expertise for empty string", () => {
    const result = manager.parseExpertise("");
    expect(result.last_updated).toBe("");
    expect(result.session_count).toBe(0);
    expect(result.knowledge).toEqual({});
  });

  it("returns empty expertise for whitespace-only string", () => {
    const result = manager.parseExpertise("   \n  ");
    expect(result.last_updated).toBe("");
    expect(result.session_count).toBe(0);
    expect(result.knowledge).toEqual({});
  });

  it("parses valid YAML expertise content", () => {
    const yaml = `last_updated: "2026-04-10T00:00:00.000Z"\nsession_count: 3\nknowledge:\n  decisions:\n    - Use YAML for expertise files\n    - Prune oldest entries first\n  patterns:\n    - Always validate before writing\n`;
    const result = manager.parseExpertise(yaml);
    expect(result.last_updated).toBe("2026-04-10T00:00:00.000Z");
    expect(result.session_count).toBe(3);
    expect(result.knowledge["decisions"]).toHaveLength(2);
    expect(result.knowledge["patterns"]).toHaveLength(1);
    expect(result.knowledge["decisions"]).toContain("Use YAML for expertise files");
  });

  it("handles YAML with empty knowledge", () => {
    const yaml = `last_updated: "2026-04-01T00:00:00.000Z"\nsession_count: 1\nknowledge: {}\n`;
    const result = manager.parseExpertise(yaml);
    expect(result.session_count).toBe(1);
    expect(result.knowledge).toEqual({});
  });
});

describe("ExpertiseManager.applyDiff", () => {
  let manager: ExpertiseManager;

  beforeEach(() => {
    manager = new ExpertiseManager();
  });

  it("adds entries to a new category", () => {
    const existing: ExpertiseFile = {
      last_updated: "2026-04-01T00:00:00.000Z",
      session_count: 2,
      knowledge: {},
    };
    const diff: ExpertiseDiff = {
      agentId: "architect",
      projectId: "test",
      additions: { decisions: ["New architecture decision"] },
      removals: {},
    };
    const result = manager.applyDiff(existing, diff);
    expect(result.knowledge["decisions"]).toContain("New architecture decision");
    expect(result.session_count).toBe(3);
  });

  it("adds entries to an existing category without duplicates", () => {
    const existing: ExpertiseFile = {
      last_updated: "2026-04-01T00:00:00.000Z",
      session_count: 1,
      knowledge: { decisions: ["Existing decision"] },
    };
    const diff: ExpertiseDiff = {
      agentId: "architect",
      projectId: "test",
      additions: { decisions: ["Existing decision", "New decision"] },
      removals: {},
    };
    const result = manager.applyDiff(existing, diff);
    expect(result.knowledge["decisions"]).toHaveLength(2);
    expect(result.knowledge["decisions"]).toContain("Existing decision");
    expect(result.knowledge["decisions"]).toContain("New decision");
  });

  it("removes entries from a category", () => {
    const existing: ExpertiseFile = {
      last_updated: "2026-04-01T00:00:00.000Z",
      session_count: 3,
      knowledge: { patterns: ["Keep this", "Remove this"] },
    };
    const diff: ExpertiseDiff = {
      agentId: "sentinel",
      projectId: "test",
      additions: {},
      removals: { patterns: ["Remove this"] },
    };
    const result = manager.applyDiff(existing, diff);
    expect(result.knowledge["patterns"]).toHaveLength(1);
    expect(result.knowledge["patterns"]).toContain("Keep this");
    expect(result.knowledge["patterns"]).not.toContain("Remove this");
  });

  it("deletes a category when all entries are removed", () => {
    const existing: ExpertiseFile = {
      last_updated: "2026-04-01T00:00:00.000Z",
      session_count: 1,
      knowledge: { gotchas: ["Only entry"] },
    };
    const diff: ExpertiseDiff = {
      agentId: "sentinel",
      projectId: "test",
      additions: {},
      removals: { gotchas: ["Only entry"] },
    };
    const result = manager.applyDiff(existing, diff);
    expect(result.knowledge["gotchas"]).toBeUndefined();
  });

  it("creates new categories via additions", () => {
    const existing: ExpertiseFile = {
      last_updated: "",
      session_count: 0,
      knowledge: {},
    };
    const diff: ExpertiseDiff = {
      agentId: "catalyst",
      projectId: "test",
      additions: {
        decisions: ["Decision A"],
        patterns: ["Pattern X"],
        gotchas: ["Gotcha 1"],
      },
      removals: {},
    };
    const result = manager.applyDiff(existing, diff);
    expect(Object.keys(result.knowledge)).toHaveLength(3);
    expect(result.knowledge["decisions"]).toContain("Decision A");
    expect(result.knowledge["patterns"]).toContain("Pattern X");
    expect(result.knowledge["gotchas"]).toContain("Gotcha 1");
  });

  it("increments session_count on each diff", () => {
    const existing: ExpertiseFile = { last_updated: "", session_count: 5, knowledge: {} };
    const diff: ExpertiseDiff = { agentId: "a", projectId: "p", additions: {}, removals: {} };
    const result = manager.applyDiff(existing, diff);
    expect(result.session_count).toBe(6);
  });

  it("updates last_updated timestamp", () => {
    const before = new Date().toISOString();
    const existing: ExpertiseFile = { last_updated: "old", session_count: 0, knowledge: {} };
    const diff: ExpertiseDiff = { agentId: "a", projectId: "p", additions: {}, removals: {} };
    const result = manager.applyDiff(existing, diff);
    expect(result.last_updated >= before).toBe(true);
  });
});

describe("ExpertiseManager.pruneExpertise", () => {
  let manager: ExpertiseManager;

  beforeEach(() => {
    manager = new ExpertiseManager();
  });

  it("returns expertise unchanged when under the limit", () => {
    const expertise: ExpertiseFile = {
      last_updated: "2026-04-10T00:00:00.000Z",
      session_count: 2,
      knowledge: {
        decisions: ["D1", "D2"],
        patterns: ["P1"],
      },
    };
    const result = manager.pruneExpertise(expertise, 10);
    expect(result).toBe(expertise); // same reference
    expect(result.knowledge["decisions"]).toHaveLength(2);
  });

  it("returns expertise unchanged when exactly at limit", () => {
    const expertise: ExpertiseFile = {
      last_updated: "2026-04-10T00:00:00.000Z",
      session_count: 1,
      knowledge: { decisions: ["D1", "D2", "D3"] },
    };
    const result = manager.pruneExpertise(expertise, 3);
    expect(result).toBe(expertise);
  });

  it("prunes entries when over the limit", () => {
    const expertise: ExpertiseFile = {
      last_updated: "2026-04-10T00:00:00.000Z",
      session_count: 5,
      knowledge: {
        decisions: ["D1", "D2", "D3", "D4", "D5"],
        patterns: ["P1", "P2", "P3", "P4", "P5"],
      },
    };
    const result = manager.pruneExpertise(expertise, 4);
    // 4 / 2 categories = 2 per category
    expect(result.knowledge["decisions"]).toHaveLength(2);
    expect(result.knowledge["patterns"]).toHaveLength(2);
    // Should keep the most recent (slice from the end)
    expect(result.knowledge["decisions"]).toContain("D4");
    expect(result.knowledge["decisions"]).toContain("D5");
    expect(result.knowledge["patterns"]).toContain("P4");
    expect(result.knowledge["patterns"]).toContain("P5");
  });

  it("returns expertise unchanged for empty knowledge", () => {
    const expertise: ExpertiseFile = {
      last_updated: "",
      session_count: 0,
      knowledge: {},
    };
    const result = manager.pruneExpertise(expertise, 5);
    expect(result).toBe(expertise);
  });

  it("ensures at least 1 entry per category after pruning", () => {
    const expertise: ExpertiseFile = {
      last_updated: "2026-04-10T00:00:00.000Z",
      session_count: 1,
      knowledge: {
        a: ["A1", "A2"],
        b: ["B1", "B2"],
        c: ["C1", "C2"],
        d: ["D1", "D2"],
        e: ["E1", "E2"],
      },
    };
    // maxLines=2, 5 categories → Math.floor(2/5)=0 → max(1,0)=1 per category
    const result = manager.pruneExpertise(expertise, 2);
    for (const cat of Object.keys(result.knowledge)) {
      expect(result.knowledge[cat].length).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("ExpertiseManager.serializeExpertise", () => {
  let manager: ExpertiseManager;

  beforeEach(() => {
    manager = new ExpertiseManager();
  });

  it("produces valid YAML that round-trips correctly", () => {
    const expertise: ExpertiseFile = {
      last_updated: "2026-04-10T00:00:00.000Z",
      session_count: 3,
      knowledge: {
        decisions: ["Use YAML", "Test everything"],
        patterns: ["One pattern"],
      },
    };
    const yaml = manager.serializeExpertise(expertise);
    expect(typeof yaml).toBe("string");
    expect(yaml.length).toBeGreaterThan(0);
    // Round-trip: parse it back
    const parsed = manager.parseExpertise(yaml);
    expect(parsed.session_count).toBe(3);
    expect(parsed.knowledge["decisions"]).toContain("Use YAML");
    expect(parsed.knowledge["patterns"]).toContain("One pattern");
  });

  it("serializes empty expertise without errors", () => {
    const expertise: ExpertiseFile = {
      last_updated: "",
      session_count: 0,
      knowledge: {},
    };
    const yaml = manager.serializeExpertise(expertise);
    expect(typeof yaml).toBe("string");
    expect(yaml.length).toBeGreaterThan(0);
  });
});

describe("ExpertiseManager.injectIntoPrompt", () => {
  let manager: ExpertiseManager;

  beforeEach(() => {
    manager = new ExpertiseManager();
  });

  it("returns empty string for zero-session expertise", () => {
    const expertise: ExpertiseFile = {
      last_updated: "2026-04-10T00:00:00.000Z",
      session_count: 0,
      knowledge: { decisions: ["Something"] },
    };
    const result = manager.injectIntoPrompt(expertise);
    expect(result).toBe("");
  });

  it("returns empty string for expertise with empty knowledge", () => {
    const expertise: ExpertiseFile = {
      last_updated: "2026-04-10T00:00:00.000Z",
      session_count: 5,
      knowledge: {},
    };
    const result = manager.injectIntoPrompt(expertise);
    expect(result).toBe("");
  });

  it("formats expertise as markdown with Prior Knowledge heading", () => {
    const expertise: ExpertiseFile = {
      last_updated: "2026-04-10T00:00:00.000Z",
      session_count: 2,
      knowledge: {
        decisions: ["Use YAML", "Test everything"],
      },
    };
    const result = manager.injectIntoPrompt(expertise);
    expect(result).toContain("## Prior Knowledge");
    expect(result).toContain("2 previous session(s)");
    expect(result).toContain("### decisions");
    expect(result).toContain("- Use YAML");
    expect(result).toContain("- Test everything");
  });

  it("replaces underscores with spaces in category headings", () => {
    const expertise: ExpertiseFile = {
      last_updated: "2026-04-10T00:00:00.000Z",
      session_count: 1,
      knowledge: {
        key_decisions: ["A decision"],
        code_patterns: ["A pattern"],
      },
    };
    const result = manager.injectIntoPrompt(expertise);
    expect(result).toContain("### key decisions");
    expect(result).toContain("### code patterns");
  });

  it("includes all categories in markdown output", () => {
    const expertise: ExpertiseFile = {
      last_updated: "2026-04-10T00:00:00.000Z",
      session_count: 3,
      knowledge: {
        decisions: ["D1"],
        patterns: ["P1"],
        gotchas: ["G1"],
      },
    };
    const result = manager.injectIntoPrompt(expertise);
    expect(result).toContain("### decisions");
    expect(result).toContain("### patterns");
    expect(result).toContain("### gotchas");
    expect(result).toContain("- D1");
    expect(result).toContain("- P1");
    expect(result).toContain("- G1");
  });
});
