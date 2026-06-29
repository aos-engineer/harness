import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const CLI = resolve(import.meta.dir, "../../cli/src/index.ts");

describe("aos replay formatting", () => {
  test("renders governance events without falling back to raw JSON", () => {
    const tmp = mkdtempSync(join(tmpdir(), "aos-replay-format-"));
    const transcript = join(tmp, "transcript.jsonl");
    try {
      writeFileSync(
        transcript,
        [
          JSON.stringify({
            type: "steer",
            timestamp: "2026-04-27T00:00:00.000Z",
            source: "user_command",
            target: "arbiter",
            message: "Please wrap up.",
          }),
          JSON.stringify({
            type: "tool-denied",
            timestamp: "2026-04-27T00:00:01.000Z",
            agent: "operator",
            tool: "execute_code",
            reason: "tool is not enabled in profile",
          }),
          JSON.stringify({
            type: "session_resumed",
            timestamp: "2026-04-27T00:00:02.000Z",
            sessionId: "session-test",
          }),
        ].join("\n") + "\n",
      );

      const result = spawnSync("bun", [CLI, "replay", transcript], {
        encoding: "utf-8",
      });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("STEER");
      expect(result.stdout).toContain("TOOL DENIED");
      expect(result.stdout).toContain("SESSION RESUMED");
      expect(result.stdout).not.toContain("[tool-denied]");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
