import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { $ } from "bun";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { validatePlatformUrl } from "../../cli/src/utils";

// Minimal valid profile.yaml — just enough to pass loadProfile + validateBrief
// so the code path reaches the platformUrl validation site in run.ts. Without
// this seed, `aos run` exits early on "No profiles found" and the wiring
// test passes vacuously.
const MINIMAL_PROFILE_YAML = `schema: aos/profile/v1
id: default
name: Default
version: 0.0.1
assembly:
  orchestrator: arbiter
  perspectives: []
delegation:
  default: broadcast
  opening_rounds: 1
  tension_pairs: []
  bias_limit: 1
constraints:
  time:
    min_minutes: 1
    max_minutes: 1
  budget:
    min: 0.01
    max: 0.01
    currency: USD
  rounds:
    min: 1
    max: 1
input:
  format: brief
  required_sections: []
output:
  format: memo
  path_template: "out/{{session_id}}/memo.md"
  sections: []
`;

describe("validatePlatformUrl (spec D5)", () => {
  beforeEach(() => {
    delete process.env.AOS_ALLOW_INSECURE_PLATFORM_URL;
  });

  test("accepts https URL", () => {
    const u = validatePlatformUrl("https://api.example.com/v1");
    expect(u.protocol).toBe("https:");
  });

  test("accepts http://localhost and http://127.0.0.1", () => {
    expect(validatePlatformUrl("http://localhost:8080").hostname).toBe("localhost");
    expect(validatePlatformUrl("http://127.0.0.1:8080").hostname).toBe("127.0.0.1");
  });

  test("rejects plain http to a non-loopback host", () => {
    expect(() => validatePlatformUrl("http://api.example.com")).toThrow(/scheme.*not allowed/);
  });

  test("rejects file://, ftp://, and other schemes", () => {
    expect(() => validatePlatformUrl("file:///etc/passwd")).toThrow(/scheme/);
    expect(() => validatePlatformUrl("ftp://example.com")).toThrow(/scheme/);
  });

  test("rejects link-local / metadata addresses", () => {
    expect(() => validatePlatformUrl("http://169.254.169.254/")).toThrow(/link-local|metadata/);
    expect(() => validatePlatformUrl("http://169.254.0.1/")).toThrow(/link-local|metadata/);
  });

  test("rejects garbage input", () => {
    expect(() => validatePlatformUrl("not a url")).toThrow();
    expect(() => validatePlatformUrl("")).toThrow();
  });

  test("AOS_ALLOW_INSECURE_PLATFORM_URL bypass works", () => {
    process.env.AOS_ALLOW_INSECURE_PLATFORM_URL = "1";
    expect(() => validatePlatformUrl("http://10.0.0.1/")).not.toThrow();
    expect(() => validatePlatformUrl("file:///tmp/x")).not.toThrow();
    delete process.env.AOS_ALLOW_INSECURE_PLATFORM_URL;
  });
});

describe("platformUrl wiring in run.ts", () => {
  test(".aos/config.yaml with link-local platform URL exits 2", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "aos-plat-url-"));
    // Minimum shape getHarnessRoot recognizes as a project.
    mkdirSync(join(tmp, "core", "agents", "arbiter"), { recursive: true });
    writeFileSync(join(tmp, "core", "agents", "arbiter", "agent.yaml"), "id: arbiter\n");
    // Seed a minimal valid profile so `aos run default` proceeds past profile
    // resolution and actually reaches the platformUrl validation site.
    mkdirSync(join(tmp, "core", "profiles", "default"), { recursive: true });
    writeFileSync(
      join(tmp, "core", "profiles", "default", "profile.yaml"),
      MINIMAL_PROFILE_YAML,
    );
    mkdirSync(join(tmp, ".aos"), { recursive: true });
    writeFileSync(
      join(tmp, ".aos", "config.yaml"),
      "adapter: pi\nplatform:\n  enabled: true\n  url: http://169.254.169.254/\n",
    );
    writeFileSync(join(tmp, "brief.md"), "# test\n");

    try {
      const result = await $`bun run ${join(process.cwd(), "cli/src/index.ts")} run default --brief ${join(tmp, "brief.md")}`
        .cwd(tmp)
        .env({ ...process.env, CI: "1" })
        .nothrow()
        .quiet();
      expect(result.exitCode).toBe(2);
      expect(result.stderr.toString()).toMatch(/platform\.url.*169\.254|169\.254.*link-local|169\.254.*metadata/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }, 60_000);
});
