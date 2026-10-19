#!/usr/bin/env bun
// The plugin's MCP server. Claude Code tells a server where the project is through CLAUDE_PROJECT_DIR and
// does not promise a working directory, so runs go under that project. The working directory is the
// fallback for other launchers, and for a value left unexpanded as a literal "${...}" placeholder. The
// plugin's MCP registration points AOS_PACK at the reference pack; the default covers a source checkout.
import { join } from "node:path";
import { serveStdio } from "@aos-harness/kernel/mcp";

const project = process.env.CLAUDE_PROJECT_DIR;

await serveStdio({
  cwd: project !== undefined && project !== "" && !project.includes("${") ? project : process.cwd(),
  packDir: process.env.AOS_PACK || join(import.meta.dirname, "../../../packs/feature-delivery"),
  host: process.env.AOS_HOST || "claude-code",
});
