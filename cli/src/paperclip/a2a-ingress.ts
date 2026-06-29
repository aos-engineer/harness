// ── a2a-ingress.ts (Phase 4 — A2A ingress wiring) ────────────────
// Adapts an A2aServer into the structural ServerDeps.a2a that the Paperclip
// HTTP handler (http.ts) serves, and builds an AgentExecutor that runs an AOS
// execution pass per inbound A2A message.
//
// Mount example (in a server entrypoint, when profile.runtime_requirements
// .a2a_serve is on):
//
//   const server = new A2aServer({ card, endpointUrl, executor });
//   Bun.serve({ port, fetch: (req) => handleRequest(req, {
//     wakeToken: "", a2a: buildA2aServerDeps(server, { authToken }),
//   })});
//
// The executor is where the real engine lives: map the inbound text to an AOS
// execution-mode pass and return its package as an Artifact. A `runPass`
// function (e.g. createEnginePass from pass-runner) is adapted by passExecutor.

import type { ServerDeps } from "./http";
import type { A2aServer, AgentExecutor, AgentExecutorResult } from "@aos-harness/runtime/a2a-server";

export interface A2aIngressOptions {
  /** Out-of-band bearer token required on the JSON-RPC endpoint. */
  authToken?: string;
  /** JSON-RPC endpoint path. Default "/a2a". */
  path?: string;
  /** Header carrying the caller identity for per-caller ingress limits. */
  callerKeyHeader?: string;
  /** JWKS document ({keys:[…]}) to serve at /.well-known/jwks.json for `jku`. */
  jwks?: () => unknown;
}

export function buildA2aServerDeps(server: A2aServer, opts: A2aIngressOptions = {}): NonNullable<ServerDeps["a2a"]> {
  return {
    authToken: opts.authToken,
    path: opts.path,
    callerKeyHeader: opts.callerKeyHeader,
    jwks: opts.jwks,
    agentCard: () => server.agentCard(),
    handleRpc: (body, ctx) => server.handle(body, ctx),
  };
}

/**
 * Adapt a text-in/text-out AOS execution pass into an AgentExecutor: the inbound
 * A2A message text becomes the pass input; the pass output becomes a single
 * text Artifact. Swap in a richer mapping (multi-artifact, files) as needed.
 */
export function passExecutor(runPass: (text: string) => Promise<string>): AgentExecutor {
  return async (input): Promise<AgentExecutorResult> => {
    const output = await runPass(input.text);
    return {
      artifacts: [{ artifactId: `${input.taskId}-result`, parts: [{ kind: "text", text: output }] }],
      state: "completed",
    };
  };
}
