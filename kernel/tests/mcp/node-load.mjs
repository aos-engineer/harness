// Loaded by Node (not Bun): the MCP server must run wherever the kernel does, including argument
// validation, which loads ajv at runtime.
const { createAosMcpServer } = await import("../../src/mcp/index.ts");
const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");

const server = createAosMcpServer({ cwd: process.cwd(), packDir: ".", host: "node" });
const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
await server.connect(serverSide);
const client = new Client({ name: "node-load", version: "0.0.0" });
await client.connect(clientSide);
const bad = await client.callTool({ name: "aos_status", arguments: {} });
const missing = await client.callTool({ name: "aos_status", arguments: { runId: "01JZZZZZZZZZZZZZZZZZZZZZZZ" } });
console.log(JSON.stringify([bad.content[0].text.split(":")[0], missing.content[0].text.split(":")[0]]));
await client.close();
