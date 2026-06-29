import { describe, it, expect } from "bun:test";
import { renderArtifactGallery, renderExecutionPackage } from "../src/output-renderer";
import type { ArtifactManifest } from "../src/types";

describe("renderExecutionPackage", () => {
  it("renders complete execution package with frontmatter", () => {
    const artifacts = new Map();
    artifacts.set("requirements_analysis", {
      manifest: {
        schema: "aos/artifact/v1",
        id: "requirements_analysis",
        produced_by: ["advocate"],
        step_id: "understand",
        format: "markdown",
        content_path: "/tmp/req.md",
        metadata: {
          produced_at: "2026-03-24T00:00:00Z",
          review_status: "approved",
          review_gate: "understand",
          word_count: 50,
          revision: 1,
        },
      },
      content: "# User Stories\n\nAs a user, I want to...",
    });

    const result = renderExecutionPackage({
      profile: "cto-execution",
      workflow: "cto-execution-workflow",
      sessionId: "abc123",
      domain: null,
      participants: ["architect", "advocate"],
      briefPath: "briefs/test/brief.md",
      transcriptPath: "sessions/test/transcript.jsonl",
      durationMinutes: 12.5,
      stepsCompleted: ["understand"],
      gatesPassed: ["understand"],
      artifacts,
      executiveSummary: "We are building a new auth system.",
    });

    expect(result).toContain("schema: aos/output/v1");
    expect(result).toContain("profile: cto-execution");
    expect(result).toContain("workflow: cto-execution-workflow");
    expect(result).toContain("phases_completed:");
    expect(result).toContain("gates_passed:");
    expect(result).toContain("# Execution Package");
    expect(result).toContain("We are building a new auth system.");
    expect(result).toContain("As a user, I want to...");
  });

  it("uses default sections when none specified", () => {
    const result = renderExecutionPackage({
      profile: "test",
      workflow: "test-workflow",
      sessionId: "xyz",
      domain: null,
      participants: [],
      briefPath: "",
      transcriptPath: "",
      durationMinutes: 0,
      stepsCompleted: [],
      gatesPassed: [],
      artifacts: new Map(),
    });

    expect(result).toContain("## 1. Requirements Analysis");
    expect(result).toContain("## 2. Architecture Decision Record");
    expect(result).toContain("## 7. Implementation Checklist");
  });

  it("shows 'Not produced' for missing artifacts", () => {
    const result = renderExecutionPackage({
      profile: "test",
      workflow: "test-workflow",
      sessionId: "xyz",
      domain: null,
      participants: [],
      briefPath: "",
      transcriptPath: "",
      durationMinutes: 0,
      stepsCompleted: [],
      gatesPassed: [],
      artifacts: new Map(),
    });

    expect(result).toContain("*Not produced in this session.*");
  });

  it("renders domain in frontmatter when provided", () => {
    const result = renderExecutionPackage({
      profile: "test",
      workflow: "test-workflow",
      sessionId: "xyz",
      domain: "saas",
      participants: [],
      briefPath: "",
      transcriptPath: "",
      durationMinutes: 0,
      stepsCompleted: [],
      gatesPassed: [],
      artifacts: new Map(),
    });
    expect(result).toContain("domain: saas");
  });

  it("uses custom sections when provided", () => {
    const result = renderExecutionPackage({
      profile: "test",
      workflow: "test-workflow",
      sessionId: "xyz",
      domain: null,
      participants: [],
      briefPath: "",
      transcriptPath: "",
      durationMinutes: 0,
      stepsCompleted: [],
      gatesPassed: [],
      artifacts: new Map(),
      sections: ["requirements_analysis", "task_breakdown"],
    });

    expect(result).toContain("## 1. Requirements Analysis");
    expect(result).toContain("## 2. Task Breakdown");
    expect(result).not.toContain("Architecture Decision Record");
  });
});

describe("renderArtifactGallery", () => {
  it("renders manifest and preserves provided index.html", () => {
    const result = renderArtifactGallery({
      profile: "design-variations",
      sessionId: "abc123",
      briefPath: "briefs/test.md",
      briefContent: "## Target Component\nCard",
      participants: ["artifact-renderer", "sentinel"],
      source: {
        files: [
          {
            path: "index.html",
            content: "<html><body>Gallery</body></html>",
            format: "html-static",
          },
          {
            path: "variation-01.html",
            content: "<html><body>One</body></html>",
            format: "html-static",
            variation_index: 1,
          },
        ],
      },
    });

    expect(result.files.find((file) => file.path === "index.html")?.content).toContain("Gallery");
    expect(result.files.find((file) => file.path === "manifest.json")?.content).toContain('"profile": "design-variations"');
    expect(result.manifest.artifacts[0]?.format).toBe("html-static");
  });

  it("auto-generates index.html when only artifact files are provided", () => {
    const result = renderArtifactGallery({
      profile: "linkedin-post",
      sessionId: "session-1",
      briefPath: "briefs/post.md",
      briefContent: "## Topic\nLaunch",
      participants: ["content-director", "visual-designer"],
      source: {
        files: [
          {
            path: "variant-01.html",
            content: "<html><body>Variant 1</body></html>",
            format: "html-static",
            platform: "linkedin",
          },
        ],
      },
    });

    const index = result.files.find((file) => file.path === "index.html");
    expect(index).toBeDefined();
    expect(index?.content).toContain("variant-01");
    expect(result.manifest.artifacts.some((artifact) => artifact.path === "variant-01.html")).toBe(true);
  });
});
