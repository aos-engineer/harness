// Minimal MCP stdio server fixture for tests. Speaks newline-delimited
// JSON-RPC 2.0 and implements just enough of the lifecycle to exercise
// McpClientV2 / McpToolsetManager: initialize, notifications/initialized,
// tools/list, tools/call. Not a test file itself (no *.test.ts suffix).

let buffer = "";

function send(obj: unknown): void {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

process.stdin.on("data", (chunk: Buffer) => {
  buffer += chunk.toString();
  const lines = buffer.split("\n");
  buffer = lines.pop() ?? "";
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let msg: any;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      continue;
    }

    if (msg.method === "notifications/initialized") continue; // notification → no reply

    if (msg.method === "initialize") {
      send({
        jsonrpc: "2.0",
        id: msg.id,
        result: {
          protocolVersion: "2025-06-18",
          serverInfo: { name: "mock", version: "1.0.0" },
          capabilities: { tools: {} },
        },
      });
      continue;
    }

    if (msg.method === "tools/list") {
      send({
        jsonrpc: "2.0",
        id: msg.id,
        result: {
          tools: [
            { name: "echo", description: "echo arguments back", inputSchema: { type: "object" } },
            { name: "shout", description: "uppercase the input", inputSchema: { type: "object" } },
          ],
        },
      });
      continue;
    }

    if (msg.method === "tools/call") {
      const name = msg.params?.name;
      const args = msg.params?.arguments ?? {};
      if (name === "shout") {
        send({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: String(args.input ?? "").toUpperCase() }] } });
      } else if (name === "echo") {
        send({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: JSON.stringify(args) }] } });
      } else if (name === "boom") {
        send({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: "tool failed" }], isError: true } });
      } else {
        send({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: `unknown tool ${name}` } });
      }
      continue;
    }

    if (msg.id !== undefined) {
      send({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "method not found" } });
    }
  }
});
