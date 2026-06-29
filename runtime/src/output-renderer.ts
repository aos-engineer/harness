import * as yaml from "js-yaml";
import { createHash } from "node:crypto";
import type { ArtifactManifest } from "./types";

export interface ExecutionPackageOpts {
  profile: string;
  workflow: string;
  sessionId: string;
  domain: string | null;
  participants: string[];
  briefPath: string;
  transcriptPath: string;
  durationMinutes: number;
  stepsCompleted: string[];
  gatesPassed: string[];
  artifacts: Map<string, { manifest: ArtifactManifest; content: string }>;
  sections?: string[];
  executiveSummary?: string;
}

const DEFAULT_SECTIONS = [
  "executive_summary",
  "requirements_analysis",
  "architecture_decision_record",
  "phase_plan",
  "task_breakdown",
  "risk_assessment",
  "stress_test_findings",
  "implementation_checklist",
];

function toTitleCase(slug: string): string {
  return slug
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function renderExecutionPackage(opts: ExecutionPackageOpts): string {
  const frontmatter: Record<string, unknown> = {
    schema: "aos/output/v1",
    date: new Date().toISOString().slice(0, 10),
    session_id: opts.sessionId,
    duration_minutes: opts.durationMinutes,
    profile: opts.profile,
    domain: opts.domain,
    participants: opts.participants,
    brief_path: opts.briefPath,
    transcript_path: opts.transcriptPath,
    workflow: opts.workflow,
    phases_completed: opts.stepsCompleted,
    gates_passed: opts.gatesPassed,
  };

  const yamlStr = yaml.dump(frontmatter, {
    lineWidth: -1,
    noRefs: true,
    quotingType: "'",
    forceQuotes: false,
  });

  const sections = opts.sections ?? DEFAULT_SECTIONS;

  const lines: string[] = [];
  lines.push("---");
  lines.push(yamlStr.trimEnd());
  lines.push("---");
  lines.push("");
  lines.push(`# Execution Package: ${opts.sessionId}`);
  lines.push("");

  // Executive Summary is always rendered first, unnumbered
  lines.push("## Executive Summary");
  lines.push("");
  lines.push(opts.executiveSummary ?? "*No executive summary provided.*");
  lines.push("");

  // Render remaining numbered sections
  const numberedSections = sections.filter((s) => s !== "executive_summary");
  for (let i = 0; i < numberedSections.length; i++) {
    const section = numberedSections[i];
    const heading = toTitleCase(section);
    lines.push(`## ${i + 1}. ${heading}`);
    lines.push("");
    const artifact = opts.artifacts.get(section);
    if (artifact) {
      lines.push(artifact.content);
    } else {
      lines.push("*Not produced in this session.*");
    }
    lines.push("");
  }

  return lines.join("\n");
}

export interface ArtifactGalleryFile {
  id?: string;
  path: string;
  content: string;
  format?: Extract<ArtifactManifest["format"], "html-static" | "html-interactive" | "html-live">;
  platform?: ArtifactManifest["platform"];
  variation_index?: number;
  revision?: number;
}

export interface ArtifactGallerySource {
  title?: string;
  files?: ArtifactGalleryFile[];
  artifacts?: ArtifactGalleryFile[];
  index?: { content: string; path?: string };
  mempalace_writeback?: string | Record<string, unknown> | null;
}

export interface ArtifactGalleryRenderOpts {
  profile: string;
  sessionId: string;
  briefPath: string;
  briefContent: string;
  participants: string[];
  source: string | ArtifactGallerySource;
  createdAt?: string;
}

export interface RenderedArtifactGallery {
  files: Array<{ path: string; content: string }>;
  manifest: {
    schema: "aos/manifest/v1";
    session_id: string;
    profile: string;
    created_at: string;
    brief_hash: string;
    agents: string[];
    artifacts: Array<{
      id: string;
      format: Extract<ArtifactManifest["format"], "html-static" | "html-interactive" | "html-live">;
      path: string;
      platform?: ArtifactManifest["platform"];
      variation_index?: number;
      revision: number;
    }>;
    mempalace_writeback: string | null;
  };
}

function normalizeGallerySource(source: string | ArtifactGallerySource): ArtifactGallerySource {
  if (typeof source === "string") {
    return {
      files: [{ path: "index.html", content: source, format: "html-static" }],
    };
  }
  return source;
}

function sanitizeArtifactId(path: string, fallbackIndex: number): string {
  const fileName = path.split("/").pop() ?? `artifact-${fallbackIndex + 1}`;
  const stem = fileName.replace(/\.[^.]+$/, "");
  const normalized = stem
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return normalized || `artifact_${fallbackIndex + 1}`;
}

function renderArtifactGalleryIndex(title: string, files: ArtifactGalleryFile[]): string {
  const cards = files
    .filter((file) => file.path !== "index.html")
    .map((file) => {
      const label = file.path.replace(/\.html$/, "");
      return `
      <article class="artifact-card">
        <header>
          <h2>${label}</h2>
          <a href="./${file.path}" target="_blank" rel="noreferrer">Open</a>
        </header>
        <iframe src="./${file.path}" title="${label} preview" loading="lazy"></iframe>
      </article>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f4f1ea;
        --panel: #fffdf8;
        --ink: #1d1b18;
        --muted: #6f675d;
        --line: #d8cfc3;
        --accent: #b85c38;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: Georgia, "Times New Roman", serif;
        background:
          radial-gradient(circle at top left, rgba(184, 92, 56, 0.18), transparent 28rem),
          linear-gradient(180deg, #f7f3ec 0%, var(--bg) 100%);
        color: var(--ink);
      }
      main {
        width: min(1200px, calc(100vw - 2rem));
        margin: 0 auto;
        padding: 2rem 0 4rem;
      }
      header.page-header {
        margin-bottom: 2rem;
      }
      header.page-header p {
        color: var(--muted);
        max-width: 42rem;
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
        gap: 1rem;
      }
      .artifact-card {
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 18px;
        overflow: hidden;
        box-shadow: 0 14px 40px rgba(29, 27, 24, 0.08);
      }
      .artifact-card header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 1rem;
        padding: 1rem 1.25rem;
        border-bottom: 1px solid var(--line);
      }
      .artifact-card h2 {
        margin: 0;
        font-size: 1.05rem;
      }
      .artifact-card a {
        color: var(--accent);
        text-decoration: none;
        font-weight: 600;
      }
      iframe {
        width: 100%;
        min-height: 420px;
        border: 0;
        background: white;
      }
    </style>
  </head>
  <body>
    <main>
      <header class="page-header">
        <h1>${title}</h1>
        <p>Generated by AOS. Open any artifact directly or inspect the previews below.</p>
      </header>
      <section class="grid">
        ${cards || `<article class="artifact-card"><header><h2>Artifact</h2></header><iframe src="./index.html" title="artifact preview"></iframe></article>`}
      </section>
    </main>
  </body>
</html>`;
}

export function renderArtifactGallery(opts: ArtifactGalleryRenderOpts): RenderedArtifactGallery {
  const createdAt = opts.createdAt ?? new Date().toISOString();
  const normalized = normalizeGallerySource(opts.source);
  const sourceFiles = normalized.files ?? normalized.artifacts ?? [];
  const files = [...sourceFiles];

  if (normalized.index?.content) {
    files.unshift({
      path: normalized.index.path ?? "index.html",
      content: normalized.index.content,
      format: "html-static",
    });
  }

  if (files.length === 0) {
    throw new Error("Artifact gallery source did not provide any files");
  }

  if (!files.some((file) => file.path === "index.html")) {
    files.unshift({
      path: "index.html",
      content: renderArtifactGalleryIndex(normalized.title ?? `${opts.profile} gallery`, files),
      format: "html-static",
    });
  }

  const manifest = {
    schema: "aos/manifest/v1" as const,
    session_id: opts.sessionId,
    profile: opts.profile,
    created_at: createdAt,
    brief_hash: `sha256:${createHash("sha256").update(opts.briefContent).digest("hex")}`,
    agents: opts.participants,
    artifacts: files
      .filter((file) => file.path.endsWith(".html"))
      .map((file, index) => ({
        id: file.id ?? sanitizeArtifactId(file.path, index),
        format: file.format ?? "html-static",
        path: file.path,
        platform: file.platform,
        variation_index: file.variation_index,
        revision: file.revision ?? 1,
      })),
    mempalace_writeback:
      normalized.mempalace_writeback == null
        ? null
        : typeof normalized.mempalace_writeback === "string"
          ? "mempalace-writeback.json"
          : "mempalace-writeback.json",
  };

  const renderedFiles: Array<{ path: string; content: string }> = files.map((file) => ({
    path: file.path,
    content: file.content,
  }));

  renderedFiles.push({
    path: "manifest.json",
    content: JSON.stringify(manifest, null, 2),
  });

  if (normalized.mempalace_writeback) {
    renderedFiles.push({
      path: "mempalace-writeback.json",
      content:
        typeof normalized.mempalace_writeback === "string"
          ? normalized.mempalace_writeback
          : JSON.stringify(normalized.mempalace_writeback, null, 2),
    });
  }

  return {
    files: renderedFiles,
    manifest,
  };
}
