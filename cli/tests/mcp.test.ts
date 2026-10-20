import { expect, test } from "bun:test";
import { mcpCommand } from "../src/commands/mcp.ts";
import { fakeIO } from "./fake-io.ts";

test("aos mcp --help prints usage and exits 0 without serving", async () => {
  for (const flag of ["--help", "-h"]) {
    const io = fakeIO({ argv: ["mcp", flag] });
    expect(await mcpCommand(io)).toBe(0);
    expect(io.stdout).toContain("Usage: aos mcp [--pack <dir>]");
    expect(io.stdout).toContain("not gated");
  }
});

test("aos mcp rejects an unknown argument with exit 2", async () => {
  const io = fakeIO({ argv: ["mcp", "--bogus"] });
  expect(await mcpCommand(io)).toBe(2);
  expect(io.stderr).toContain('unknown argument "--bogus"');
});
