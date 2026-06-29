import { spawn, type ChildProcess } from "node:child_process";
import type { HealthStatus } from "./memory-provider";

export class McpClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpClientError";
  }
}

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

export class McpClient {
  private process: ChildProcess | null = null;
  private command: string;
  private args: string[];
  private nextId = 1;
  private pendingRequests = new Map<number, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }>();
  private buffer = "";

  constructor(command: string, args: string[]) {
    this.command = command;
    this.args = args;
  }

  isRunning(): boolean {
    return this.process !== null && !this.process.killed && this.process.exitCode === null;
  }

  async start(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      try {
        this.process = spawn(this.command, this.args, {
          stdio: ["pipe", "pipe", "pipe"],
        });
      } catch (e) {
        reject(new McpClientError(`Failed to spawn: ${e}`));
        return;
      }

      this.process.on("error", (err) => {
        reject(new McpClientError(`Process error: ${err.message}`));
      });

      this.process.on("exit", (code) => {
        for (const [, pending] of this.pendingRequests) {
          pending.reject(new McpClientError(`Process exited with code ${code}`));
        }
        this.pendingRequests.clear();
        this.process = null;
      });

      if (this.process.stdout) {
        this.process.stdout.on("data", (chunk: Buffer) => {
          this.buffer += chunk.toString();
          this.processBuffer();
        });
      }

      setTimeout(() => {
        if (this.isRunning()) {
          resolve();
        } else {
          reject(new McpClientError("Process exited immediately"));
        }
      }, 500);
    });
  }

  async stop(): Promise<void> {
    if (this.process && !this.process.killed) {
      this.process.kill();
      this.process = null;
    }
    this.pendingRequests.clear();
    this.buffer = "";
  }

  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  async call(method: string, params?: Record<string, unknown>): Promise<unknown> {
    if (!this.isRunning()) {
      throw new McpClientError("MCP server is not running");
    }

    const id = this.nextId++;
    const request: JsonRpcRequest = {
      jsonrpc: "2.0",
      id,
      method,
      ...(params ? { params } : {}),
    };

    return new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new McpClientError(`Request ${id} timed out`));
      }, 30000);

      this.pendingRequests.set(id, {
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value);
        },
        reject: (err) => {
          clearTimeout(timeout);
          reject(err);
        },
      });

      try {
        this.process!.stdin!.write(JSON.stringify(request) + "\n");
      } catch (e) {
        this.pendingRequests.delete(id);
        clearTimeout(timeout);
        reject(new McpClientError(`Failed to write to stdin: ${e}`));
      }
    });
  }

  async healthCheck(): Promise<HealthStatus> {
    const start = Date.now();
    try {
      await this.call("tools/list");
      return { healthy: true, latencyMs: Date.now() - start };
    } catch (e) {
      return {
        healthy: false,
        latencyMs: Date.now() - start,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  private processBuffer(): void {
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const response = JSON.parse(trimmed) as JsonRpcResponse;
        const pending = this.pendingRequests.get(response.id);
        if (pending) {
          this.pendingRequests.delete(response.id);
          if (response.error) {
            pending.reject(new McpClientError(response.error.message));
          } else {
            pending.resolve(response.result);
          }
        }
      } catch {
        // Non-JSON line — ignore
      }
    }
  }
}
