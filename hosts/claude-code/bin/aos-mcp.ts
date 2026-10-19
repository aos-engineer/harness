#!/usr/bin/env bun
// The plugin's MCP server. Claude Code starts it in the project directory, and the plugin's MCP
// registration points AOS_PACK at the reference pack; the fallback covers running it from a checkout.
import { join } from "node:path";
import { serveStdio } from "@aos-harness/kernel/mcp";

await serveStdio({
  cwd: process.cwd(),
  packDir: process.env.AOS_PACK || join(import.meta.dirname, "../../../packs/feature-delivery"),
  host: process.env.AOS_HOST || "claude-code",
});
