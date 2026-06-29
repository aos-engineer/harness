#!/usr/bin/env bun
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { connect, Socket } from "node:net";
import { randomUUID } from "node:crypto";

const SOCK = process.env.AOS_BRIDGE_SOCKET;
if (!SOCK) {
  console.error("AOS_BRIDGE_SOCKET env var is required");
  process.exit(1);
}

let sock: Socket | null = null;
const pending = new Map<string, (msg: any) => void>();
let buf = "";

function ensureSock(): Promise<Socket> {
  if (sock && !sock.destroyed) return Promise.resolve(sock);
  return new Promise((resolve, reject) => {
    const s = connect(SOCK!);
    s.on("connect", () => { sock = s; resolve(s); });
    s.on("error", reject);
    s.on("data", (chunk) => {
      buf += chunk.toString("utf-8");
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          const cb = pending.get(msg.id);
          if (cb) { pending.delete(msg.id); cb(msg); }
        } catch { /* ignore */ }
      }
    });
    s.on("close", () => { sock = null; });
  });
}

async function rpc(method: string, params: unknown): Promise<unknown> {
  const s = await ensureSock();
  const id = randomUUID();
  return new Promise((resolve, reject) => {
    pending.set(id, (msg) => {
      if (msg.error) reject(new Error(msg.error));
      else resolve(msg.result);
    });
    s.write(JSON.stringify({ id, method, params }) + "\n");
  });
}

const server = new Server(
  { name: "aos-arbiter-bridge", version: "0.9.1" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "delegate",
      description: "Delegate a message to one or more participant agents and receive their responses.",
      inputSchema: {
        type: "object" as const,
        properties: {
          to: { description: "Agent id, list of ids, or 'all'", type: "string" },
          message: { type: "string" },
        },
        required: ["to", "message"],
      },
    },
    {
      name: "end",
      description: "End the deliberation. Provide a closing summary message.",
      inputSchema: {
        type: "object" as const,
        properties: { closing_message: { type: "string" } },
        required: ["closing_message"],
      },
    },
    {
      name: "aos_recall",
      description: "Search long-term AOS memory for relevant past knowledge.",
      inputSchema: {
        type: "object" as const,
        properties: {
          query: { type: "string" },
          agent: { type: "string", description: "Optional agent id to limit recall." },
          hall: { type: "string", description: "Optional memory hall/category." },
          max_results: { type: "number", description: "Maximum entries to return." },
        },
        required: ["query"],
      },
    },
    {
      name: "aos_remember",
      description: "Commit an important fact, decision, or lesson to long-term AOS memory.",
      inputSchema: {
        type: "object" as const,
        properties: {
          content: { type: "string" },
          agent: { type: "string", description: "Agent that produced the memory." },
          hall: { type: "string", description: "Optional memory hall/category." },
          source: { type: "string", description: "Optional source label." },
        },
        required: ["content", "agent"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const result = await rpc(req.params.name, req.params.arguments ?? {});
  return {
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
  };
});

await server.connect(new StdioServerTransport());
