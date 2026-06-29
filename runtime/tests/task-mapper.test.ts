import { test, expect, describe } from "bun:test";
import { partsToText, taskToText, mapStateToStatus, a2aToAgentResponse } from "../src/task-mapper";
import type { A2aTask, A2aMessage } from "../src/a2a-client";

describe("task-mapper", () => {
  test("partsToText renders text/data/file parts", () => {
    expect(
      partsToText([
        { kind: "text", text: "a" },
        { kind: "data", data: { x: 1 } },
        { kind: "file", file: { name: "f.png" } },
      ]),
    ).toBe('a\n{"x":1}\n[file: f.png]');
  });

  test("partsToText does not crash on a data part with no data field", () => {
    // JSON.stringify(undefined) is undefined; the fix coerces it to "".
    expect(partsToText([{ kind: "data" }, { kind: "text", text: "ok" }])).toBe("ok");
  });

  test("taskToText prefers artifacts, falls back to the status message", () => {
    const withArtifact: A2aTask = {
      id: "t",
      status: { state: "completed", message: { role: "agent", parts: [{ kind: "text", text: "msg" }] } },
      artifacts: [{ artifactId: "a", parts: [{ kind: "text", text: "art" }] }],
    };
    expect(taskToText(withArtifact)).toBe("art");
    const noArtifact: A2aTask = {
      id: "t",
      status: { state: "completed", message: { role: "agent", parts: [{ kind: "text", text: "msg" }] } },
    };
    expect(taskToText(noArtifact)).toBe("msg");
  });

  test("mapStateToStatus collapses the 9 states", () => {
    expect(mapStateToStatus("completed")).toBe("success");
    expect(mapStateToStatus("failed")).toBe("failed");
    expect(mapStateToStatus("rejected")).toBe("failed");
    expect(mapStateToStatus("canceled")).toBe("aborted");
    expect(mapStateToStatus("input-required")).toBe("success");
    expect(mapStateToStatus("working")).toBe("success");
  });

  test("completed task → success response, cost 0, not paused", () => {
    const t: A2aTask = {
      id: "t1",
      contextId: "c1",
      status: { state: "completed" },
      artifacts: [{ artifactId: "a", parts: [{ kind: "text", text: "42" }] }],
    };
    const r = a2aToAgentResponse(t, "a2a:peer");
    expect(r.text).toBe("42");
    expect(r.status).toBe("success");
    expect(r.cost).toBe(0);
    expect(r.a2aTaskId).toBe("t1");
    expect(r.a2aContextId).toBe("c1");
    expect(r.a2aPaused).toBe(false);
  });

  test("failed task sets error", () => {
    const t: A2aTask = { id: "t1", status: { state: "failed", message: { role: "agent", parts: [{ kind: "text", text: "boom" }] } } };
    const r = a2aToAgentResponse(t);
    expect(r.status).toBe("failed");
    expect(r.error).toBe("boom");
  });

  test("input-required is a non-fatal pause", () => {
    const t: A2aTask = { id: "t1", status: { state: "input-required", message: { role: "agent", parts: [{ kind: "text", text: "name?" }] } } };
    const r = a2aToAgentResponse(t);
    expect(r.status).toBe("success");
    expect(r.a2aPaused).toBe(true);
    expect(r.text).toBe("name?");
  });

  test("bare message → success, no task id, but contextId preserved", () => {
    const m: A2aMessage = { role: "agent", parts: [{ kind: "text", text: "hi" }], contextId: "ctx-9" };
    const r = a2aToAgentResponse(m);
    expect(r.text).toBe("hi");
    expect(r.status).toBe("success");
    expect(r.a2aTaskId).toBeUndefined();
    expect(r.a2aContextId).toBe("ctx-9");
  });
});
