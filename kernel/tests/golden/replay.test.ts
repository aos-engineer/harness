// Golden logs are sanitized logs of the end-to-end bounded and spike runs. Replaying them pins gate
// evaluation: every verdict the kernel recorded must come out the same when the gate is evaluated again
// from the events before it, at the tree it was recorded against. A change that alters any recorded
// verdict fails here, so it has to be deliberate (regenerate with AOS_GOLDEN_WRITE=1 bun test ./tests/e2e).
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evaluateGate } from "../../src/gates/evaluate.ts";
import { project } from "../../src/projection.ts";
import { checkLines } from "../../src/store/log-internal.ts";
import type { EventEnvelope, GateResult } from "../../src/types.ts";
import { rehash, sanitizeLog } from "./sanitize.ts";

const GOLDEN: string[] = ["bounded", "spike"];

function readGoldenLines(name: string): string[] {
  return readFileSync(join(import.meta.dirname, "logs", `${name}.jsonl`), "utf8").split("\n").filter((l) => l !== "");
}

function readGolden(name: string): EventEnvelope[] {
  return readGoldenLines(name).map((l) => JSON.parse(l) as EventEnvelope);
}

function gateEvents(events: EventEnvelope[]): Array<{ seq: number; result: GateResult }> {
  const out: Array<{ seq: number; result: GateResult }> = [];
  for (const e of events) if (e.type === "gate.evaluated") out.push({ seq: e.seq, result: e.data });
  return out;
}

describe("golden-log replay", () => {
  test.each(GOLDEN)("%s golden log replays to identical gate verdicts", (name) => {
    const events = readGolden(name);
    const gates = gateEvents(events);
    expect(gates.length).toBeGreaterThan(0);
    for (const { seq, result } of gates) {
      const before = project(events.filter((x) => x.seq < seq));
      expect(evaluateGate(before, result.stage, { fingerprint: result.fingerprint, weak: result.weakFreshness })).toEqual(result);
    }
  });

  test("golden logs verify their hash chain", () => {
    for (const name of GOLDEN) expect(checkLines(readGoldenLines(name))).toEqual({ ok: true, badSeq: null, reason: null });
  });

  // A regenerated log that only ever passed would replay trivially; these keep the failing and waiting
  // paths under replay.
  test("together the golden logs record pending, failing, and passing gates", () => {
    const verdicts = new Set(GOLDEN.flatMap((n) => gateEvents(readGolden(n)).map((g) => g.result.verdict)));
    expect([...verdicts].sort()).toEqual(["fail", "pass", "pending"]);
  });

  test("golden logs name no machine path or account", () => {
    for (const name of GOLDEN) {
      for (const e of readGolden(name)) {
        if (e.type === "run.started") expect(e.data.root).toBe("/repo");
        if (e.actor.kind === "human") expect(e.actor.id).toBe("owner");
      }
    }
  });
});

describe("sanitizer", () => {
  const ROOT = "/private/var/folders/xy/T/aos-repo-abc";
  const line = (seq: number, prev: string, actor: object, data: object) =>
    JSON.stringify({ v: 1, seq, id: `E${seq}`, run: "R", ts: "2026-10-19T00:00:00.000Z", actor, type: "x", data, prev });
  const raw = [
    line(1, "sha256:" + "0".repeat(64), { kind: "agent", id: "mcp:aos_run_start", agent: null }, { root: ROOT }),
    line(2, "sha256:stale", { kind: "human", id: "segun", agent: null }, { text: `aos approve R design --root "${ROOT.slice("/private".length)}"` }),
  ];

  test("moves the root, under either of its macOS names, to /repo and names the human owner", () => {
    const out = sanitizeLog(raw, { root: ROOT, home: "/Users/segun", user: "segun" }).map((l) => JSON.parse(l));
    expect(out[0].data.root).toBe("/repo");
    expect(out[1].data.text).toBe('aos approve R design --root "/repo"');
    expect(out[1].actor.id).toBe("owner");
  });

  test("rebuilds the chain so the rewritten lines verify", () => {
    expect(checkLines(raw).ok).toBe(false);
    expect(checkLines(sanitizeLog(raw, { root: ROOT, home: "/Users/segun", user: "segun" })).ok).toBe(true);
    expect(checkLines(rehash(raw)).ok).toBe(true);
  });

  test("refuses to return a log that still names a temp path outside the root", () => {
    const remote = join(tmpdir(), "aos-remote-xyz");
    const leaky = [line(1, "sha256:" + "0".repeat(64), { kind: "agent", id: "x", agent: null }, { note: `pushed to ${remote}` })];
    expect(() => sanitizeLog(leaky, { root: ROOT, home: "/Users/segun", user: "segun" })).toThrow("sanitized golden log still contains");
  });
});
