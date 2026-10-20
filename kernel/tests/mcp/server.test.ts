import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createAosMcpServer } from "../../src/mcp/server.ts";
import { TOOL_NAMES, TOOLS } from "../../src/mcp/tools.ts";
import { projector } from "../../src/projection.ts";
import { appendEvents, loadState } from "../../src/store/store.ts";
import { tmpDir, tmpGitRepo, writeFile } from "../helpers.ts";
import { PACK } from "../ops-agent/fixtures.ts";

interface Result { isError?: boolean; content: Array<{ type: string; text: string }>; structuredContent?: Record<string, unknown> }

let repo: string;
let client: Client;

async function connect(packDir = PACK): Promise<Client> {
  const server = createAosMcpServer({ cwd: repo, packDir, host: "test" });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const c = new Client({ name: "aos-test", version: "0.0.0" });
  await c.connect(clientSide);
  return c;
}

beforeEach(async () => {
  repo = tmpGitRepo();
  client = await connect();
});
afterEach(async () => client.close());

const call = async (name: string, args: Record<string, unknown>, c = client): Promise<Result> =>
  (await c.callTool({ name, arguments: args })) as Result;
const body = (r: Result): Record<string, unknown> => JSON.parse(r.content[0]?.text ?? "null");
const text = (r: Result): string => r.content[0]?.text ?? "";
const evidenceCount = (runId: string) => loadState({ root: repo, run: runId }, projector).state.evidence.length;

async function startRun(brief = "Fix README typo"): Promise<string> {
  const r = await call("aos_run_start", { brief });
  expect(r.isError).toBeFalsy();
  return String(body(r).runId);
}

describe("tool list", () => {
  test("lists exactly the eight tools, in order", async () => {
    expect([...TOOL_NAMES]).toEqual([
      "aos_run_start", "aos_status", "aos_gate_check", "aos_stage_advance",
      "aos_task_add", "aos_task_complete", "aos_evidence_record", "aos_request_approval",
    ]);
    expect((await client.listTools()).tools.map((t) => t.name)).toEqual([...TOOL_NAMES]);
  });

  test("descriptions tell the agent what each tool does and what it may not do", () => {
    expect(Object.fromEntries(TOOLS.map((t) => [t.name, t.description]))).toEqual({
      aos_run_start: "Start an AOS run for one piece of work. Returns the run id, the proposed risk tier and why, the stages, and the first stage's instructions. Tell the human the tier and reason before you start.",
      aos_status: "Show a run's stage, gate state, open gaps, and iteration budget. Read-only.",
      aos_gate_check: "Evaluate the current stage's gate now and list what is missing or stale.",
      aos_stage_advance: "Pass the current gate and enter the next stage. Fails with the open gaps if the gate is not satisfied.",
      aos_task_add: "Add a task to the current stage. All tasks must be completed before the stage's gate passes.",
      aos_task_complete: "Mark a task in the current stage completed.",
      aos_evidence_record: "Record claimed evidence: an artifact path, a file:line citation, a review result, or a skill you used. Test runs are observed automatically; you cannot record them here.",
      aos_request_approval: "Ask the human to approve the current stage. Present your design or question first. The human approves from their own terminal; never run aos approve yourself.",
    });
  });

  test("no tool approves, waives, lowers, extends, pauses, or cancels", () => {
    expect(TOOL_NAMES.filter((n) => /approve$|waive|lower|extend|pause|cancel/.test(n))).toEqual([]);
  });

  // Hosts hand these schemas to model APIs, and some reject a top-level oneOf, anyOf, or allOf.
  test("every input schema is a closed object without top-level combinators", () => {
    for (const t of TOOLS) {
      const s = t.inputSchema as Record<string, unknown>;
      expect(s).toMatchObject({ type: "object", additionalProperties: false });
      for (const k of ["oneOf", "anyOf", "allOf", "not", "if"]) expect(Object.hasOwn(s, k)).toBe(false);
    }
  });

  test("no schema can carry provenance, and command is not an evidence kind", () => {
    for (const t of TOOLS) expect(JSON.stringify(t.inputSchema)).not.toContain("provenance");
    const evidence = TOOLS.find((t) => t.name === "aos_evidence_record")?.inputSchema as { properties: { kind: { enum: string[] } } };
    expect(evidence.properties.kind.enum).toEqual(["artifact", "citation", "review", "skill"]);
  });
});

describe("tool calls", () => {
  test("run_start round-trips and status reads it", async () => {
    const r = await call("aos_run_start", { brief: "Fix README typo" });
    expect(r.content[0]?.text).toMatch(/"runId":"[0-9A-HJKMNP-TV-Z]{26}"/);
    expect(r.structuredContent).toEqual(body(r));
    const { runId } = body(r);
    expect(body(await call("aos_status", { runId })).stage).toBe("design");
  });

  test("every tool reaches its operation", async () => {
    const runId = await startRun();
    expect(body(await call("aos_gate_check", { runId }))).toMatchObject({ gate: { stage: "design", verdict: "pending" } });
    expect(body(await call("aos_stage_advance", { runId }))).toMatchObject({ advanced: false, stage: "design" });
    expect(body(await call("aos_task_add", { runId, title: "write the heading" }))).toEqual({ task: "t1", stage: "design" });
    writeFile(repo, "docs/specs/heading.md", "# Heading\n");
    const ev = body(await call("aos_evidence_record", { runId, kind: "artifact", path: "docs/specs/heading.md" }));
    expect(ev.evidenceId).toBeString();
    expect(body(await call("aos_task_complete", { runId, task: "t1", evidence: [ev.evidenceId] }))).toEqual({ task: "t1", open: 0 });
    expect(String(body(await call("aos_request_approval", { runId, summary: "Retitle the README." })).instructions)).toContain("do not run it yourself");

    const human = { kind: "human" as const, id: "human:tester", agent: null };
    const { approvals } = loadState({ root: repo, run: runId }, projector).state;
    const request = approvals[0]?.request ?? "";
    appendEvents({ root: repo, run: runId }, [{ type: "approval.granted", actor: human, data: { request, stage: "design", reason: null } }], projector);
    expect(body(await call("aos_stage_advance", { runId }))).toMatchObject({ advanced: true, stage: "build" });
  });

  test("MCP cannot create observed evidence", async () => {
    const runId = await startRun();
    expect((await call("aos_evidence_record", { runId, kind: "review", status: "approved", feedback: "ok", reviewer: "me", provenance: "observed" })).isError).toBe(true);
    expect((await call("aos_evidence_record", { runId, kind: "command", command: "bun test", exitCode: 0 })).isError).toBe(true);
    expect(evidenceCount(runId)).toBe(0);
  });

  test("each evidence kind admits only its own fields", async () => {
    const runId = await startRun();
    const review = await call("aos_evidence_record", { runId, kind: "review", status: "approved", feedback: "ok", reviewer: "me", path: "README.md" });
    expect(review.isError).toBe(true);
    expect(text(review)).toStartWith("invalid: ");
    expect(text(review)).toContain("path");
    const artifact = await call("aos_evidence_record", { runId, kind: "artifact" });
    expect(text(artifact)).toContain("path");
    expect(evidenceCount(runId)).toBe(0);
  });

  test("a citation's note is optional", async () => {
    const runId = await startRun();
    writeFile(repo, "src/a.ts", "one\n");
    const r = await call("aos_evidence_record", { runId, kind: "citation", path: "src/a.ts", line: 1 });
    expect(r.isError).toBeFalsy();
    const { evidence } = loadState({ root: repo, run: runId }, projector).state;
    expect(evidence[0]).toMatchObject({ kind: "citation", path: "src/a.ts", line: 1, note: "" });
  });

  test("bad arguments are rejected before any operation runs", async () => {
    const missing = await call("aos_run_start", {});
    expect(missing.isError).toBe(true);
    expect(text(missing)).toStartWith("invalid: ");
    expect(text(missing)).toContain("brief");
    const extra = await call("aos_run_start", { brief: "Fix typo", force: true });
    expect(text(extra)).toContain("force");
    const tier = await call("aos_run_start", { brief: "Fix typo", tier: "huge" });
    expect(text(tier)).toContain("spike, bounded, architectural");
  });

  test("OpError becomes isError with its code", async () => {
    const r = await call("aos_status", { runId: "01JZZZZZZZZZZZZZZZZZZZZZZZ" });
    expect(r.isError).toBe(true);
    expect(r.content[0]?.text).toStartWith("not_found:");
    const refused = await call("aos_run_start", { brief: "Add a users migration" });
    expect(text(refused)).toStartWith("refused: The architectural tier is not available");
  });

  test("an unknown tool is an error, not a crash", async () => {
    const r = await call("aos_approve", { runId: "x" });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain("aos_approve");
  });

  test("an unexpected failure is reported as internal and the server keeps serving", async () => {
    const broken = await connect(tmpDir());
    const r = await call("aos_run_start", { brief: "Fix typo" }, broken);
    expect(r.isError).toBe(true);
    expect(text(r)).toStartWith("internal: ");
    expect((await broken.listTools()).tools.length).toBe(8);
    expect((await call("aos_status", { runId: "01JZZZZZZZZZZZZZZZZZZZZZZZ" }, broken)).content[0]?.text).toStartWith("not_found:");
    await broken.close();
  });
});

test("the MCP server loads and validates under Node", () => {
  const r = spawnSync("node", [join(import.meta.dirname, "node-load.mjs")], { cwd: tmpDir(), encoding: "utf8" });
  expect(r.stderr).toBe("");
  expect(JSON.parse(r.stdout)).toEqual(["invalid", "not_found"]);
});

// Each Claude Code session spawns its own server, so the run it started is the obvious default.
describe("runId default", () => {
  test("a call without runId uses the run this server started", async () => {
    await startRun();
    const r = await call("aos_status", {});
    expect(r.isError).toBeFalsy();
    expect(body(r).stage).toBe("design");
  });

  test("an explicit runId wins over the default", async () => {
    const other = await connect();
    const otherRun = String(body(await call("aos_run_start", { brief: "Fix a second typo" }, other)).runId);
    await other.close();
    const mine = await startRun();
    expect(body(await call("aos_status", { runId: otherRun })).runId).toBe(otherRun);
    expect(body(await call("aos_status", {})).runId).toBe(mine);
  });

  test("without a run started here, a missing runId says what to pass", async () => {
    const r = await call("aos_request_approval", { summary: "design" });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain("pass the runId that aos_run_start returned");
  });
});
