#!/usr/bin/env bun
// The plugin's MCP server. Claude Code tells a server where the project is through CLAUDE_PROJECT_DIR and
// does not promise a working directory, so runs go under that project. The working directory is the
// fallback for other launchers, and for a value left unexpanded as a literal "${...}" placeholder. The
// plugin's MCP registration points AOS_PACK at the pack shipped inside the plugin; without it the pack is
// found next to this entry point (the bundled layout), then in the repository (a source checkout).
import "@aos-harness/kernel/ajv-static";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { serveStdio } from "@aos-harness/kernel/mcp";

const packCandidates = [join(import.meta.dirname, "../pack"), join(import.meta.dirname, "../../../packs/feature-delivery")];

const project = process.env.CLAUDE_PROJECT_DIR;

await serveStdio({
  cwd: project !== undefined && project !== "" && !project.includes("${") ? project : process.cwd(),
  packDir: process.env.AOS_PACK || packCandidates.find((p) => existsSync(join(p, "pack.yaml"))) || packCandidates[1]!,
  host: process.env.AOS_HOST || "claude-code",
});
