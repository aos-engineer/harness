import { test, expect, describe } from "bun:test";
import { join } from "node:path";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { buildBrief } from "../../cli/src/paperclip/brief";
import { loadProfile, validateBrief } from "../../runtime/src/config-loader";
import type { Issue } from "../../cli/src/paperclip/types";

const issue: Issue = {
  id: "ISSUE-1",
  title: "Add a /metrics endpoint to the gateway",
  definitionOfDone: "Expose Prometheus metrics on /metrics. Leave the issue in in_review. Do not publish.",
};

describe("buildBrief", () => {
  const brief = buildBrief({ issue, date: "2026-06-04" });

  test("contains every section heading the worker profile requires", () => {
    const profile = loadProfile(join(process.cwd(), "core/profiles/paperclip-worker"));
    const lower = brief.toLowerCase();
    for (const s of profile.input.required_sections) {
      expect(lower).toContain(s.heading.toLowerCase());
    }
  });

  test("embeds the issue title and definition of done", () => {
    expect(brief).toContain(issue.title!);
    expect(brief).toContain("Prometheus metrics");
  });

  test("carries the never-publish review gate", () => {
    const normalized = brief.toLowerCase().replace(/\s+/g, " ");
    expect(normalized).toContain("do not mark the issue done");
    expect(normalized).toContain("do not publish");
  });

  test("falls back gracefully when no definition of done is provided", () => {
    const b = buildBrief({ issue: { id: "X", title: "Just a title" }, date: "2026-06-04" });
    expect(b).toContain("Just a title");
    expect(b.toLowerCase()).toContain("no explicit definition of done");
  });

  test("passes the framework's own validateBrief against the profile", () => {
    const dir = mkdtempSync(join(tmpdir(), "paperclip-brief-"));
    const p = join(dir, "brief.md");
    writeFileSync(p, brief, "utf-8");
    const profile = loadProfile(join(process.cwd(), "core/profiles/paperclip-worker"));
    const v = validateBrief(p, profile.input.required_sections);
    expect(v.valid).toBe(true);
    expect(v.missing).toHaveLength(0);
  });
});
