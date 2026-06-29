// Wake server entrypoint: wires config -> runner -> Bun.serve.
//
// This is the container's long-running process. It exposes the authenticated
// /paperclip/wake webhook and a /healthz check. The routine that drives wakes
// lives in Paperclip and stays DISABLED until the operator enables it; this
// server only responds to wakes, it never schedules them.

import { WorkerRunner } from "./worker-runner";
import { PaperclipClient } from "./paperclip-client";
import { createEnginePass } from "./pass-runner";
import { loadWorkerConfig, redactConfig, type WorkerConfig } from "./config";
import { handleRequest } from "./http";

export function buildRunner(cfg: WorkerConfig): WorkerRunner {
  return new WorkerRunner({
    paperclip: new PaperclipClient(cfg.paperclip),
    runPass: createEnginePass(cfg),
  });
}

export function startServer(cfg: WorkerConfig = loadWorkerConfig()) {
  const runner = buildRunner(cfg);
  const server = Bun.serve({
    port: cfg.port,
    idleTimeout: 30,
    fetch: (req) =>
      handleRequest(req, {
        wakeToken: cfg.wakeToken,
        dispatch: (wake) => {
          runner.handleWake(wake).catch((err) => {
            console.error("[worker] wake failed:", err instanceof Error ? err.message : err);
          });
        },
      }),
  });
  console.error(`[worker] listening on :${server.port}`);
  console.error("[worker] config:", JSON.stringify(redactConfig(cfg)));
  return server;
}

if (import.meta.main) {
  startServer();
}
