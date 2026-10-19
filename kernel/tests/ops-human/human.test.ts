import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import * as os from "node:os";
import { join } from "node:path";
import { evaluateGate } from "../../src/gates/evaluate.ts";
import { approve, cancelRun, deny, humanActor, pendingApproval } from "../../src/ops/human.ts";
import { loadPack } from "../../src/pack/load.ts";
import { projector } from "../../src/projection.ts";
import { readLog } from "../../src/store/log.ts";
import { bindSession, findBinding } from "../../src/store/sessions.ts";
import { appendEvents, createRun, loadState } from "../../src/store/store.ts";
import type { Actor, EventEnvelope, RunLocation, RunState } from "../../src/types.ts";
import { ulid } from "../../src/util/ulid.ts";
import { tmpDir } from "../helpers.ts";
import { mutateLine } from "../store/fixtures.ts";

const PACK_DIR = join(import.meta.dirname, "../../../packs/feature-delivery");
const PACK = loadPack(PACK_DIR);
const AGENT: Actor = { kind: "agent", id: "mcp:aos_request_approval", agent: null };
const HOOK: Actor = { kind: "hook", id: "claude-code:PostToolUse", agent: null };
const KERNEL: Actor = { kind: "kernel", id: "aos", agent: null };
// Gate evaluation only needs a tree name here; freshness is not under test.
const TREE = { fingerprint: "counter:0", weak: true };

let root: string;
let run: string;
let loc: RunLocation;

beforeEach(() => {
  root = tmpDir("aos-human-");
  run = ulid();
  loc = { root, run };
  createRun(loc, {
    type: "run.started",
    actor: AGENT,
    data: { brief: "add a widget", tier: "bounded", tierReason: "default", root, git: false, host: "claude-code", pack: PACK },
  }, projector);
});

function state(): RunState {
  return loadState(loc, projector).state;
}

function events(): EventEnvelope[] {
  return readLog(loc).events;
}

function lastEvent(): EventEnvelope {
  const all = events();
  return all[all.length - 1];
}

let requests = 0;
function request(stage = "design", summary = "Design: one widget, no new deps."): string {
  const id = `req_${++requests}`;
  appendEvents(loc, [{ type: "approval.requested", actor: AGENT, data: { request: id, stage, summary } }], projector);
  return id;
}

function enter(stage: string, index: number): void {
  appendEvents(loc, [{ type: "stage.entered", actor: KERNEL, data: { stage, index } }], projector);
}

const code = (c: string) => expect.objectContaining({ code: c });

describe("humanActor", () => {
  test("names the OS user as a human with no agent", () => {
    expect(humanActor()).toEqual({ kind: "human", id: os.userInfo().username, agent: null });
  });

  describe("when the OS has no passwd entry for the user", () => {
    const saved = { USER: process.env.USER, LOGNAME: process.env.LOGNAME };
    let spy: ReturnType<typeof spyOn>;
    beforeEach(() => {
      spy = spyOn(os, "userInfo").mockImplementation(() => {
        throw new Error("uv_os_get_passwd returned ENOENT");
      });
    });
    afterEach(() => {
      spy.mockRestore();
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    });

    test("falls back to USER", () => {
      process.env.USER = "ci-user";
      process.env.LOGNAME = "ci-logname";
      expect(humanActor().id).toBe("ci-user");
    });

    test("then LOGNAME", () => {
      delete process.env.USER;
      process.env.LOGNAME = "ci-logname";
      expect(humanActor().id).toBe("ci-logname");
    });

    test("then a fixed placeholder, so an approval never fails for want of a name", () => {
      delete process.env.USER;
      delete process.env.LOGNAME;
      expect(humanActor()).toEqual({ kind: "human", id: "unknown", agent: null });
    });
  });
});

describe("pendingApproval", () => {
  test("is the latest undecided request for the current stage", () => {
    request();
    const second = request("design", "Design v2");
    expect(pendingApproval(state())).toMatchObject({ request: second, stage: "design", summary: "Design v2" });
  });

  test("is null once the latest request is decided, even if an older one never was", () => {
    request();
    const second = request();
    approve(loc, { actor: humanActor(), reason: null, request: second });
    expect(pendingApproval(state())).toBeNull();
  });

  // Gate evaluation ignores decisions by any other actor, so a forged grant or denial must not stop the
  // human from deciding the request either.
  test("stays pending after a decision logged by a non-human actor", () => {
    const id = request();
    appendEvents(loc, [{ type: "approval.granted", actor: AGENT, data: { request: id, stage: "design", reason: "self-approved" } }], projector);
    expect(pendingApproval(state())?.request).toBe(id);
    approve(loc, { actor: humanActor(), reason: null, request: id });
    expect(evaluateGate(state(), "design", TREE).verdict).toBe("pass");
  });

  test("ignores requests made before the stage was last entered", () => {
    request();
    enter("design", 0);
    expect(pendingApproval(state())).toBeNull();
  });

  test("is null for a stage the run is not on", () => {
    request();
    expect(pendingApproval(state(), "build")).toBeNull();
    expect(pendingApproval(state(), "design")).not.toBeNull();
  });

  test("is null once the run is no longer active", () => {
    request();
    cancelRun(loc, { actor: humanActor(), reason: "abandoned" });
    expect(pendingApproval(state())).toBeNull();
  });
});

describe("approve", () => {
  test("grants the pending request as the human", () => {
    const id = request();
    expect(approve(loc, { actor: humanActor(), reason: null })).toEqual({ request: id, stage: "design" });
    expect(lastEvent()).toMatchObject({ type: "approval.granted", actor: { kind: "human" }, data: { request: id, stage: "design", reason: null } });
  });

  test("passes the human gate it was asked for", () => {
    request();
    approve(loc, { actor: humanActor(), reason: "looks right" });
    expect(evaluateGate(state(), "design", TREE).verdict).toBe("pass");
  });

  test("non-human actors cannot approve, and nothing is logged", () => {
    request();
    const before = events().length;
    for (const actor of [AGENT, HOOK, KERNEL]) {
      expect(() => approve(loc, { actor, reason: null })).toThrow(code("invalid"));
    }
    expect(events().length).toBe(before);
  });

  test("with nothing pending is not_found", () => {
    expect(() => approve(loc, { actor: humanActor(), reason: null })).toThrow(code("not_found"));
  });

  test("for a stage the run is not on is not_found", () => {
    request();
    expect(() => approve(loc, { stage: "build", actor: humanActor(), reason: null })).toThrow(code("not_found"));
  });

  test("pinned to the request the human saw refuses once a newer request replaced it", () => {
    const seen = request();
    request("design", "a different summary the human never read");
    const before = events().length;
    expect(() => approve(loc, { actor: humanActor(), reason: null, request: seen })).toThrow(code("not_found"));
    expect(events().length).toBe(before);
  });

  test("refuses a tampered log even when the snapshot still matches its last line", () => {
    request();
    mutateLine(loc, 0);
    const before = readLog(loc).lines.length;
    expect(() => approve(loc, { actor: humanActor(), reason: null })).toThrow(expect.objectContaining({ name: "ChainError", badSeq: 2 }));
    expect(readLog(loc).lines.length).toBe(before);
  });
});

describe("deny", () => {
  test("needs a reason", () => {
    request();
    expect(() => deny(loc, { actor: humanActor(), reason: "" })).toThrow(code("invalid"));
    expect(() => deny(loc, { actor: humanActor(), reason: "  \n" })).toThrow(code("invalid"));
  });

  test("records the denial and fails the gate", () => {
    const id = request();
    expect(deny(loc, { actor: humanActor(), reason: "split the widget in two" })).toEqual({ request: id, stage: "design" });
    expect(lastEvent()).toMatchObject({ type: "approval.denied", actor: { kind: "human" }, data: { request: id, reason: "split the widget in two" } });
    expect(evaluateGate(state(), "design", TREE).verdict).toBe("fail");
  });

  test("non-human actors cannot deny", () => {
    request();
    expect(() => deny(loc, { actor: AGENT, reason: "no" })).toThrow(code("invalid"));
  });

  test("with nothing pending is not_found", () => {
    expect(() => deny(loc, { actor: humanActor(), reason: "no" })).toThrow(code("not_found"));
  });
});

describe("cancelRun", () => {
  test("ends the run and unbinds its sessions", () => {
    bindSession(root, "claude-code", "S1", run);
    expect(cancelRun(loc, { actor: humanActor(), reason: "abandoned" }).unbound).toBe(1);
    expect(findBinding(root, "claude-code", "S1")).toBeNull();
    expect(state().status).toBe("cancelled");
    expect(lastEvent()).toMatchObject({ type: "run.cancelled", actor: { kind: "human" }, data: { reason: "abandoned" } });
  });

  test("leaves other runs' sessions bound", () => {
    bindSession(root, "claude-code", "S2", "other-run");
    expect(cancelRun(loc, { actor: humanActor(), reason: "abandoned" }).unbound).toBe(0);
    expect(findBinding(root, "claude-code", "S2")?.run).toBe("other-run");
  });

  test("non-human actors cannot cancel", () => {
    expect(() => cancelRun(loc, { actor: AGENT, reason: "done" })).toThrow(code("invalid"));
    expect(state().status).toBe("active");
  });

  test("needs a reason", () => {
    expect(() => cancelRun(loc, { actor: humanActor(), reason: " " })).toThrow(code("invalid"));
    expect(state().status).toBe("active");
  });

  test("refuses a run that is not active", () => {
    cancelRun(loc, { actor: humanActor(), reason: "abandoned" });
    const before = events().length;
    expect(() => cancelRun(loc, { actor: humanActor(), reason: "again" })).toThrow(code("invalid"));
    expect(events().length).toBe(before);
  });
});
