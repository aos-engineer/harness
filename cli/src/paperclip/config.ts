// Runtime configuration for the Paperclip worker, read from the environment.
//
// SECURITY: no secret values are ever hardcoded here. Secrets (the Paperclip
// API key, the inbound wake token, the AOS provider key) arrive only via env,
// injected by the deploy platform's secret store at deploy time. This module
// reads names, never embeds values.

import { join } from "node:path";

export interface PaperclipApiConfig {
  /** Base URL of the Paperclip control plane, e.g. https://paperclip.example. */
  apiBase: string;
  /** The agent's Paperclip API key (used to authenticate callbacks). */
  apiKey: string;
  /** Header used to send the API key. Default: Authorization: Bearer <key>. */
  authHeader: string;
  authScheme: string;
}

export interface WorkerConfig {
  /** Port the wake server listens on. */
  port: number;
  /** Bearer token required on inbound /paperclip/wake calls. */
  wakeToken: string;
  /** AOS adapter platform (e.g. claude-code). */
  platform: string;
  /** Harness repo root (contains core/). */
  root: string;
  /** Resolved profile directory (the execution profile run per wake). */
  profileDir: string;
  /** Resolved workflows directory. */
  workflowsDir: string;
  paperclip: PaperclipApiConfig;
}

function req(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return v;
}

function opt(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.trim() !== "" ? v : fallback;
}

/**
 * Build the full worker config from the environment. Throws (loudly, at startup)
 * if a required secret/URL is absent — fail fast rather than run half-configured.
 * The execution profile defaults to the bundled `paperclip-worker` profile;
 * point PAPERCLIP_PROFILE_DIR at your own profile to specialize.
 */
export function loadWorkerConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const root = opt("AOS_HARNESS_ROOT", process.cwd());
  return {
    port: parseInt(opt("PORT", "8080"), 10),
    wakeToken: req("PAPERCLIP_WAKE_TOKEN"),
    platform: opt("AOS_PLATFORM", "claude-code"),
    root,
    profileDir: opt("PAPERCLIP_PROFILE_DIR", join(root, "core", "profiles", "paperclip-worker")),
    workflowsDir: opt("PAPERCLIP_WORKFLOWS_DIR", join(root, "core", "workflows")),
    paperclip: {
      apiBase: req("PAPERCLIP_API_BASE").replace(/\/$/, ""),
      apiKey: req("PAPERCLIP_API_KEY"),
      authHeader: opt("PAPERCLIP_AUTH_HEADER", "Authorization"),
      authScheme: opt("PAPERCLIP_AUTH_SCHEME", "Bearer"),
    },
  };
}

/** Redact a config for safe logging — never print secret values. */
export function redactConfig(c: WorkerConfig): Record<string, unknown> {
  return {
    port: c.port,
    platform: c.platform,
    root: c.root,
    profileDir: c.profileDir,
    workflowsDir: c.workflowsDir,
    wakeToken: c.wakeToken ? "[set]" : "[missing]",
    paperclip: {
      apiBase: c.paperclip.apiBase,
      apiKey: c.paperclip.apiKey ? "[set]" : "[missing]",
      authHeader: c.paperclip.authHeader,
      authScheme: c.paperclip.authScheme,
    },
  };
}
