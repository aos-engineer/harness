// The AOS MCP server: the agent's only way to change run state. It validates every call against the
// tool's schema, runs the matching operation, and turns any failure into a tool error, so a bad call
// can never take the server down mid-session.
import { createRequire } from "node:module";
import type { Readable, Writable } from "node:stream";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import type { ErrorObject, ValidateFunction } from "ajv";
import pkg from "../../package.json" with { type: "json" };
import { evidenceRecord, gateCheck, requestApproval, runStart, runStatus, stageAdvance, taskAdd, taskComplete } from "../ops/agent.ts";
import type { EvidenceInput } from "../ops/agent.ts";
import { openContext } from "../ops/context.ts";
import type { OpContext } from "../ops/context.ts";
import type { Tier } from "../types.ts";
import { OpError } from "../util/errors.ts";
import { ARGUMENT_SCHEMAS, TOOLS } from "./tools.ts";

type Args = Record<string, unknown>;

// Arguments reach a handler only after validation, so each one reads the shape its schema guarantees.
const HANDLERS: Readonly<Record<string, (ctx: OpContext, a: Args) => object>> = {
  aos_run_start: (ctx, a) => runStart(ctx, a as { brief: string; tier?: Tier }),
  aos_status: (ctx, a) => runStatus(ctx, a as { runId: string }),
  aos_gate_check: (ctx, a) => gateCheck(ctx, a as { runId: string }),
  aos_stage_advance: (ctx, a) => stageAdvance(ctx, a as { runId: string }),
  aos_task_add: (ctx, a) => taskAdd(ctx, a as { runId: string; title: string }),
  aos_task_complete: (ctx, a) => taskComplete(ctx, a as { runId: string; task: string; evidence?: string[] }),
  aos_evidence_record: (ctx, a) => evidenceRecord(ctx, a as EvidenceInput & { runId: string }),
  aos_request_approval: (ctx, a) => requestApproval(ctx, a as { runId: string; summary: string }),
};

export function createAosMcpServer(o: { cwd: string; packDir: string; host: string }): Server {
  const server = new Server({ name: "aos", version: pkg.version }, { capabilities: { tools: {} } });
  // Opened on first use: a git lookup that fails at launch should surface as a tool error the agent can
  // report, not as a server that never starts.
  let ctx: OpContext | null = null;
  const context = () => (ctx ??= openContext(o));

  // The catalog types its schemas as plain objects; each one is a closed object schema, as the SDK expects.
  const tools: Tool[] = TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema as Tool["inputSchema"] }));
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => callTool(context, req.params.name, req.params.arguments ?? {}));
  return server;
}

/**
 * Serves the tools over stdio until the host hangs up, then resolves. The SDK transport stops only when
 * closed, and it ignores the end of stdin, so the server closes itself when its input ends.
 */
export async function serveStdio(o: { cwd: string; packDir: string; host: string }, io: { stdin?: Readable; stdout?: Writable } = {}): Promise<void> {
  const stdin = io.stdin ?? process.stdin;
  const server = createAosMcpServer(o);
  const closed = new Promise<void>((resolve) => {
    server.onclose = () => resolve();
  });
  const hangUp = () => void server.close();
  stdin.once("end", hangUp);
  stdin.once("close", hangUp);
  try {
    await server.connect(new StdioServerTransport(stdin, io.stdout ?? process.stdout));
    await closed;
  } finally {
    stdin.off("end", hangUp);
    stdin.off("close", hangUp);
  }
}

function callTool(context: () => OpContext, name: string, args: Args): CallToolResult {
  try {
    const handler = Object.hasOwn(HANDLERS, name) ? HANDLERS[name] : undefined;
    if (handler === undefined) return failure(`invalid: unknown tool "${name}". The AOS tools are: ${TOOLS.map((t) => t.name).join(", ")}.`);
    const validate = validator(name);
    if (!validate(args)) return failure(`invalid: ${describeErrors(validate.errors ?? [])}`);
    const result = handler(context(), args);
    return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result as Record<string, unknown> };
  } catch (e) {
    if (e instanceof OpError) return failure(`${e.code}: ${e.message}`);
    return failure(`internal: ${e instanceof Error ? e.message : String(e)}`);
  }
}

const failure = (text: string): CallToolResult => ({ isError: true, content: [{ type: "text", text }] });

// ajv loads at runtime through require, the same way the pack loader loads it, so the subpath also
// imports cleanly under Node, where ajv is a CommonJS module.
const requireFromHere = createRequire(import.meta.url);
const validators = new Map<string, ValidateFunction>();
function validator(name: string): ValidateFunction {
  let v = validators.get(name);
  if (v === undefined) {
    const { Ajv } = requireFromHere("ajv") as typeof import("ajv");
    v = new Ajv({ allErrors: true, discriminator: true }).compile(ARGUMENT_SCHEMAS[name] ?? {});
    validators.set(name, v);
  }
  return v;
}

function describeErrors(errors: ErrorObject[]): string {
  const lines = errors.map((e) => {
    const at = e.instancePath === "" ? "arguments" : `arguments${e.instancePath.replace(/\//g, ".")}`;
    const p = e.params as Record<string, unknown>;
    const detail =
      e.keyword === "additionalProperties" ? ` (${String(p.additionalProperty)})`
      : e.keyword === "enum" && Array.isArray(p.allowedValues) ? `: ${p.allowedValues.join(", ")}`
      : "";
    return `${at} ${e.message ?? "is invalid"}${detail}`;
  });
  return [...new Set(lines)].join("; ");
}
