import { test, expect, describe } from "bun:test";
import { join } from "node:path";
import { validateAgainstSchema, findSchemaDir } from "../src/schema-validator";

describe("schema-validator (ajv)", () => {
  test("locates the core/schema directory", () => {
    const dir = findSchemaDir();
    expect(dir).toBeTruthy();
    expect(dir).toContain(join("core", "schema"));
  });

  test("accepts a valid aos/mcp/v1 document", () => {
    const res = validateAgainstSchema("aos/mcp/v1", {
      schema: "aos/mcp/v1",
      id: "tools",
      servers: [{ id: "a", transport: "stdio", command: "x" }],
    });
    expect(res.checked).toBe(true);
    expect(res.ok).toBe(true);
    expect(res.errors).toEqual([]);
  });

  test("flags an aos/mcp/v1 stdio server missing command", () => {
    const res = validateAgainstSchema("aos/mcp/v1", {
      schema: "aos/mcp/v1",
      id: "tools",
      servers: [{ id: "a", transport: "stdio" }],
    });
    expect(res.checked).toBe(true);
    expect(res.ok).toBe(false);
    expect(res.errors.length).toBeGreaterThan(0);
  });

  test("flags an unknown additional property (additionalProperties:false)", () => {
    const res = validateAgainstSchema("aos/mcp/v1", {
      schema: "aos/mcp/v1",
      id: "tools",
      servers: [{ id: "a", transport: "stdio", command: "x", bogus: true }],
    });
    expect(res.ok).toBe(false);
  });

  test("unknown schema id is not checked (graceful no-op)", () => {
    const res = validateAgainstSchema("aos/does-not-exist/v1", { anything: true });
    expect(res.checked).toBe(false);
    expect(res.ok).toBe(true);
  });
});
