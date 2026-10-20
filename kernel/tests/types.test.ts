import { expect, test } from "bun:test";
import type { Actor, EventDataMap, EventDraft, EventEnvelope, EventType } from "../src/types.ts";

// These checks run in `bun run typecheck`: an event's data must be tied to its type.
const actor: Actor = { kind: "kernel", id: "test", agent: null };

// @ts-expect-error stage.entered data on a run.cancelled draft must not compile
const mismatched: EventDraft = { type: "run.cancelled", actor, data: { stage: "build", index: 1 } };

function briefOf(e: EventEnvelope): string | null {
  return e.type === "run.started" ? e.data.brief : null; // narrowing on type exposes run.started data
}

function draft<T extends EventType>(type: T, data: EventDataMap[T]): EventDraft<T> {
  return { type, actor, data }; // generic factories compile without casts
}

test("event drafts and envelopes discriminate on type", () => {
  expect(draft("run.cancelled", { reason: "abandoned" }).type).toBe("run.cancelled");
  expect(briefOf).toBeInstanceOf(Function);
  expect(mismatched.type).toBe("run.cancelled");
});
