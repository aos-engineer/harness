/**
 * ArtifactManager — manages the lifecycle of artifacts produced during
 * workflow execution. Artifacts are work products that agents produce,
 * stored as files with YAML manifests.
 *
 * All file I/O goes through the adapter abstraction (writeFile/readFile)
 * except for initial directory creation (mkdirSync).
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import * as yaml from "js-yaml";
import type { ArtifactManifest, LoadedArtifact } from "./types";

/** Options passed when creating an artifact. */
export interface CreateArtifactOpts {
  produced_by: string[];
  step_id: string;
  format: ArtifactManifest["format"];
  platform?: ArtifactManifest["platform"];
  variation_index?: number;
  channel_id?: string;
}

/** Minimal adapter interface needed by ArtifactManager. */
export interface ArtifactIOAdapter {
  writeFile(path: string, content: string): Promise<void>;
  readFile(path: string): Promise<string>;
}

const FORMAT_EXTENSIONS: Record<ArtifactManifest["format"], string> = {
  markdown: "md",
  code: "txt",
  "structured-data": "yaml",
  diagram: "mmd",
  "html-static": "html",
  "html-interactive": "html",
  "html-live": "html",
};

const VALID_ARTIFACT_ID = /^[a-z][a-z0-9_-]*$/;

export class ArtifactManager {
  private manifests: Map<string, ArtifactManifest> = new Map();
  private readonly artifactsDir: string;

  constructor(
    private readonly adapter: ArtifactIOAdapter,
    private readonly sessionDir: string,
  ) {
    this.artifactsDir = join(sessionDir, "artifacts");
    mkdirSync(this.artifactsDir, { recursive: true });
  }

  private validateId(id: string): void {
    if (!VALID_ARTIFACT_ID.test(id)) {
      throw new Error(
        `Invalid artifact ID "${id}". IDs must match ${VALID_ARTIFACT_ID} (lowercase alphanumeric, hyphens, underscores).`,
      );
    }
  }

  /** Create a new artifact with content and manifest. */
  async createArtifact(
    id: string,
    content: string,
    opts: CreateArtifactOpts,
  ): Promise<ArtifactManifest> {
    this.validateId(id);
    const ext = FORMAT_EXTENSIONS[opts.format];
    const contentPath = join(this.artifactsDir, `${id}.${ext}`);

    const manifest: ArtifactManifest = {
      schema: "aos/artifact/v1",
      id,
      produced_by: opts.produced_by,
      step_id: opts.step_id,
      format: opts.format,
      content_path: contentPath,
      platform: opts.platform,
      variation_index: opts.variation_index,
      channel_id: opts.channel_id,
      metadata: {
        produced_at: new Date().toISOString(),
        review_status: "pending",
        review_gate: null,
        word_count: content.split(/\s+/).filter(Boolean).length,
        revision: 1,
      },
    };

    // Write content file and manifest via adapter
    await this.adapter.writeFile(contentPath, content);
    await this.adapter.writeFile(
      this.manifestPath(id),
      yaml.dump(manifest),
    );

    // Cache in memory
    this.manifests.set(id, manifest);

    return manifest;
  }

  /** Load an artifact (manifest + content) by id. */
  async loadArtifact(id: string): Promise<LoadedArtifact> {
    this.validateId(id);
    let manifest = this.manifests.get(id);

    if (!manifest) {
      const raw = await this.adapter.readFile(this.manifestPath(id));
      manifest = yaml.load(raw, { schema: yaml.JSON_SCHEMA }) as ArtifactManifest;
      this.manifests.set(id, manifest);
    }

    const content = await this.adapter.readFile(manifest.content_path);

    return { manifest, content };
  }

  /** Format an artifact for injection into an agent's context. */
  async formatForInjection(id: string): Promise<string> {
    const { manifest, content } = await this.loadArtifact(id);
    const producers = manifest.produced_by.join(", ");

    return [
      `## Artifact: ${manifest.id}`,
      `- Produced by: ${producers}`,
      `- Step: ${manifest.step_id}`,
      `- Format: ${manifest.format}`,
      `- Revision: ${manifest.metadata.revision}`,
      `- Review status: ${manifest.metadata.review_status}`,
      "",
      content,
    ].join("\n");
  }

  /** Update the review status of an artifact. */
  async updateReviewStatus(
    id: string,
    status: ArtifactManifest["metadata"]["review_status"],
    reviewGate: string,
  ): Promise<void> {
    const manifest = await this.getManifest(id);
    manifest.metadata.review_status = status;
    manifest.metadata.review_gate = reviewGate;

    await this.adapter.writeFile(
      this.manifestPath(id),
      yaml.dump(manifest),
    );

    this.manifests.set(id, manifest);
  }

  /** Revise an artifact with new content, incrementing the revision. */
  async reviseArtifact(id: string, newContent: string): Promise<ArtifactManifest> {
    const manifest = await this.getManifest(id);

    manifest.metadata.revision += 1;
    manifest.metadata.review_status = "pending";
    manifest.metadata.word_count = newContent.split(/\s+/).filter(Boolean).length;

    await this.adapter.writeFile(manifest.content_path, newContent);
    await this.adapter.writeFile(
      this.manifestPath(id),
      yaml.dump(manifest),
    );

    this.manifests.set(id, manifest);

    return manifest;
  }

  /** Get the manifest for an artifact (from cache or disk). */
  async getManifest(id: string): Promise<ArtifactManifest> {
    this.validateId(id);
    let manifest = this.manifests.get(id);
    if (!manifest) {
      const raw = await this.adapter.readFile(this.manifestPath(id));
      manifest = yaml.load(raw, { schema: yaml.JSON_SCHEMA }) as ArtifactManifest;
      this.manifests.set(id, manifest);
    }
    return manifest;
  }

  /** Get all cached manifests. */
  getAllManifests(): ArtifactManifest[] {
    return Array.from(this.manifests.values());
  }

  private manifestPath(id: string): string {
    return join(this.artifactsDir, `${id}.artifact.yaml`);
  }
}
