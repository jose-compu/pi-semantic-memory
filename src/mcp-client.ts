/**
 * Stdio MCP client that spawns and communicates with logosdb-mcp-server.
 *
 * Keeps one persistent child process per session; reconnects automatically
 * on the next call if the process has exited.
 */

import { spawn, spawnSync } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

type RpcResponse = {
  jsonrpc: "2.0";
  id?: number;
  method?: string;
  result?: unknown;
  error?: { code: number; message: string };
};

export class LogosDBClient {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  private ready = false;
  /** Guards against concurrent start() calls. */
  private startPromise: Promise<void> | null = null;
  readonly dbPath: string;

  constructor(dbPath?: string) {
    this.dbPath = dbPath ?? join(homedir(), ".pi", "agent", "logosdb");
  }

  async ensureStarted(): Promise<void> {
    if (this.ready && this.proc) return;
    // Coalesce concurrent callers onto a single start attempt.
    if (!this.startPromise) {
      this.startPromise = this.start().finally(() => {
        this.startPromise = null;
      });
    }
    await this.startPromise;
  }

  private async start(): Promise<void> {
    mkdirSync(this.dbPath, { recursive: true });

    const [bin, ...args] = resolveCmd();
    this.proc = spawn(bin, args, {
      env: { ...process.env, LOGOSDB_PATH: this.dbPath },
      stdio: ["pipe", "pipe", "pipe"],
    }) as ChildProcessWithoutNullStreams;

    const rl = createInterface({ input: this.proc.stdout });
    rl.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        const msg = JSON.parse(trimmed) as RpcResponse;
        if (msg.id == null) return;
        const handler = this.pending.get(msg.id);
        if (!handler) return;
        this.pending.delete(msg.id);
        if (msg.error) {
          handler.reject(
            new Error(`MCP error ${msg.error.code}: ${msg.error.message}`)
          );
        } else {
          handler.resolve(msg.result);
        }
      } catch {
        // ignore malformed lines
      }
    });

    this.proc.on("exit", (code, signal) => {
      rl.close(); // release reference to the dead stdout stream
      this.ready = false;
      this.proc = null;
      // Fail outstanding RPCs immediately instead of waiting for the 60s timeout.
      const reason = new Error(
        signal
          ? `logosdb-mcp-server exited (signal ${signal})`
          : `logosdb-mcp-server exited (code ${code ?? "unknown"})`
      );
      for (const [id, handler] of this.pending) {
        this.pending.delete(id);
        handler.reject(reason);
      }
    });

    await this.rpc("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "pi-semantic-memory", version: "1.0.2" },
    });
    this.write({ jsonrpc: "2.0", method: "notifications/initialized" });
    this.ready = true;
  }

  private write(msg: object): void {
    this.proc?.stdin.write(JSON.stringify(msg) + "\n");
  }

  private rpc(method: string, params?: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject });
      this.write({ jsonrpc: "2.0", id, method, params });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`Timeout waiting for MCP response: ${method}`));
        }
      }, 60_000);
    });
  }

  async callTool(
    name: string,
    args: Record<string, unknown>
  ): Promise<string> {
    await this.ensureStarted();
    const result = (await this.rpc("tools/call", {
      name,
      arguments: args,
    })) as { content?: Array<{ type: string; text?: string }> };
    return (result?.content ?? [])
      .map((c) => c.text ?? "")
      .join("\n")
      .trim();
  }

  async index(
    text: string,
    namespace: string,
    metadata?: string
  ): Promise<void> {
    await this.callTool("logosdb_index", {
      text,
      namespace,
      ...(metadata ? { metadata } : {}),
    });
  }

  async search(
    query: string,
    namespace: string,
    topK = 5
  ): Promise<string> {
    return this.callTool("logosdb_search", {
      query,
      namespace,
      top_k: topK,
    });
  }

  async listNamespaces(): Promise<string[]> {
    const raw = await this.callTool("logosdb_list", {});
    try {
      const parsed = JSON.parse(raw) as {
        namespaces?: Array<string | { name: string }>;
      };
      return (parsed.namespaces ?? []).map((ns) =>
        typeof ns === "string" ? ns : ns.name
      );
    } catch {
      return [];
    }
  }

  async infoNamespace(namespace: string): Promise<{
    count: number;
    countLive: number;
    dim: number;
    path: string;
  }> {
    const raw = await this.callTool("logosdb_info", { namespace });
    return JSON.parse(raw) as {
      count: number;
      countLive: number;
      dim: number;
      path: string;
    };
  }

  /**
   * Index a file or directory into a namespace.
   * Skips .gitignore-excluded paths; only re-indexes files changed since the last run.
   */
  async indexDirectory(dirPath: string, namespace: string): Promise<string> {
    return this.callTool("logosdb_index_file", {
      path: dirPath,
      namespace,
      incremental: true,
      respect_gitignore: true,
    });
  }

  async deleteByQuery(namespace: string, query: string): Promise<void> {
    await this.callTool("logosdb_delete", { namespace, query });
  }

  async stop(): Promise<void> {
    if (this.proc) {
      this.proc.kill();
      this.proc = null;
      this.ready = false;
    }
  }
}

function resolveCmd(): [string, ...string[]] {
  const envBin = process.env.LOGOSDB_MCP_BIN;
  if (envBin) return [envBin];

  const which = spawnSync(
    process.platform === "win32" ? "where" : "which",
    ["logosdb-mcp-server"],
    { encoding: "utf8" }
  );
  if (which.status === 0 && which.stdout.trim()) {
    return ["logosdb-mcp-server"];
  }

  return ["npx", "--yes", "logosdb-mcp-server"];
}
