import { test, expect, describe } from "bun:test";
import { A2aTaskStore } from "../src/a2a-task-store";

describe("A2aTaskStore", () => {
  test("create / get / setState / addArtifact", () => {
    const store = new A2aTaskStore();
    const task = store.create({ contextId: "c1" });
    expect(task.status.state).toBe("submitted");
    expect(task.contextId).toBe("c1");
    expect(store.get(task.id)).toBe(task);

    store.setState(task.id, "working");
    expect(store.get(task.id)!.status.state).toBe("working");

    store.addArtifact(task.id, { artifactId: "a", parts: [{ kind: "text", text: "x" }] });
    expect(store.get(task.id)!.artifacts!.length).toBe(1);
  });

  test("cancel a non-terminal task; no-op once terminal", () => {
    const store = new A2aTaskStore();
    const t = store.create();
    store.cancel(t.id);
    expect(store.get(t.id)!.status.state).toBe("canceled");

    const done = store.create();
    store.setState(done.id, "completed");
    store.cancel(done.id);
    expect(store.get(done.id)!.status.state).toBe("completed"); // not overwritten
  });

  test("cancel/get of an unknown id is graceful", () => {
    const store = new A2aTaskStore();
    expect(store.cancel("nope")).toBeUndefined();
    expect(store.get("nope")).toBeUndefined();
  });

  test("evicts the oldest task once past maxTasks (DoS bound)", () => {
    const store = new A2aTaskStore(2);
    const a = store.create();
    const b = store.create();
    const c = store.create();
    expect(store.get(a.id)).toBeUndefined(); // oldest evicted
    expect(store.get(b.id)).toBeDefined();
    expect(store.get(c.id)).toBeDefined();
  });
});
