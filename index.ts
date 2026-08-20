/**
 * pi-semantic-memory — Pi coding agent extension.
 *
 * Local-first semantic memory backed by a local LogosDB MCP server (stdio).
 * No cloud, no external services, stdio-only.
 *
 * Automatic behaviour
 * ───────────────────
 * session_start        → detect project namespace; warm MCP server; background-index cwd
 * before_agent_start   → semantic search on every user prompt → inject context into system prompt
 * agent_end            → persist a turn record (Q+A) into memory; re-index changed files
 * session_before_compact → store a handoff note
 * session_shutdown     → gracefully stop the MCP server process
 *
 * Memory scope (LOGOS_MEMORY_MODE env var)
 * ─────────────────────────────────────────
 * "global"  (default) — turn records go to pi-global, visible across ALL sessions and projects.
 *                        Search queries both pi-global and the current project namespace.
 * "project"           — turn records and searches are isolated to the current project namespace.
 *
 * Tools
 * ─────
 *   logos_remember    → logosdb_index       (store a memory)
 *   logos_recall      → logosdb_search      (semantic search)
 *   logos_forget      → logosdb_delete      (delete by semantic match)
 *   logos_namespaces  → logosdb_list        (list all collections)
 *
 * Commands
 * ────────
 *   /logos-setup   → verify connectivity and show configuration
 *   /logos-status  → show active namespace, mode, indexing state
 *   /logos-index   → manually trigger incremental re-indexing
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { LogosDBClient } from "./src/mcp-client.js";
import {
  buildMemoryContext,
  deriveProjectNamespace,
  extractQuery,
  storeTurnMemory,
  GLOBAL_NS,
} from "./src/context.js";
import { loadConfig, sessionNamespace } from "./src/config.js";
import { runSetup } from "./src/setup.js";

// ── Project directory detection ────────────────────────────────────────────────

const PROJECT_MARKERS = [
  ".git",
  "package.json",
  "pyproject.toml",
  "Cargo.toml",
  "go.mod",
  "CMakeLists.txt",
  "Makefile",
  ".hg",
];

function isIndexableDir(dir: string): boolean {
  const home = homedir();
  if (!dir || dir === home || dir === "/" || dir.split("/").length < 3) {
    return false;
  }
  return PROJECT_MARKERS.some((m) => existsSync(join(dir, m)));
}

// ── Extension ─────────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  const dbPath =
    process.env.LOGOSDB_PATH ?? join(homedir(), ".pi", "agent", "logosdb");
  const client = new LogosDBClient(dbPath);
  const config = loadConfig();

  let projectNs = GLOBAL_NS;
  let indexing = false;

  async function backgroundIndex(dir: string, ns: string): Promise<void> {
    if (indexing || !isIndexableDir(dir)) return;
    indexing = true;
    try {
      await client.indexDirectory(dir, ns);
    } catch {
      // best-effort, non-fatal
    } finally {
      indexing = false;
    }
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────────

  pi.on("session_start", async (_event, ctx) => {
    const cwd = ctx.cwd ?? process.cwd();
    projectNs = deriveProjectNamespace(cwd);
    client
      .ensureStarted()
      .then(() => backgroundIndex(cwd, projectNs))
      .catch(() => {});
  });

  pi.on("before_agent_start", async (event, _ctx) => {
    const messages =
      (event as { messages?: Array<{ role: string; content: unknown }> })
        .messages ?? [];
    const query = extractQuery(messages, event.systemPrompt);
    if (!query.trim()) return;
    try {
      const memory = await buildMemoryContext(
        client,
        query,
        projectNs,
        config
      );
      if (!memory) return;
      return { systemPrompt: event.systemPrompt + memory };
    } catch {
      // degrade silently
    }
  });

  pi.on("agent_end", async (event, _ctx) => {
    const messages = event.messages as Array<{ role: string; content: unknown }>;
    const cwd = process.cwd();

    // Persist this turn to memory (background, silent).
    storeTurnMemory(messages, client, projectNs, config, cwd).catch(() => {});

    // Re-index files changed during the agent turn (background, silent).
    backgroundIndex(cwd, projectNs).catch(() => {});
  });

  pi.on("session_before_compact", async (_event, _ctx) => {
    const note = `[Handoff ${new Date().toISOString().slice(0, 16)}] ${process.cwd()}`;
    try {
      await client.index(note, sessionNamespace(config, projectNs), "handoff");
    } catch {
      // non-fatal
    }
  });

  pi.on("session_shutdown", async () => {
    await client.stop().catch(() => {});
  });

  // ── Tools ────────────────────────────────────────────────────────────────────

  pi.registerTool(
    defineTool({
      name: "logos_remember",
      label: "Remember (LogosDB)",
      description:
        'Store a memory in LogosDB. ' +
        'Use "pi-global" for cross-project knowledge, ' +
        'or the current project namespace for project-specific context. ' +
        'Call this whenever you learn something worth remembering across sessions.',
      parameters: Type.Object({
        text: Type.String({
          description: "The knowledge, decision, or note to persist",
        }),
        namespace: Type.String({
          description: 'Collection (default: "pi-global")',
          default: GLOBAL_NS,
        }),
        metadata: Type.Optional(
          Type.String({ description: "Optional label or tag" })
        ),
      }),
      async execute(_id, { text, namespace, metadata }) {
        const ns = namespace || GLOBAL_NS;
        try {
          await client.index(text, ns, metadata);
          return {
            content: [{ type: "text" as const, text: `stored → ${ns}` }],
            details: null,
          };
        } catch (err) {
          return {
            content: [{ type: "text" as const, text: `store failed: ${err}` }],
            details: null,
          };
        }
      },
    })
  );

  pi.registerTool(
    defineTool({
      name: "logos_recall",
      label: "Recall (LogosDB)",
      description:
        "Semantically search stored memories. Returns the most relevant entries by vector similarity.",
      parameters: Type.Object({
        query: Type.String({ description: "Natural-language search query" }),
        namespace: Type.String({
          description: 'Namespace to search (e.g. "pi-global" or "pi-proj-myapp")',
          default: GLOBAL_NS,
        }),
        top_k: Type.Optional(
          Type.Number({ description: "Max results (default: 5)" })
        ),
        hybrid: Type.Optional(
          Type.Boolean({
            description:
              "Combine vector similarity with lexical (BM25) scoring for better recall (default: true)",
            default: true,
          })
        ),
      }),
      async execute(_id, { query, namespace, top_k, hybrid }) {
        const ns = namespace || GLOBAL_NS;
        try {
          const result = await client.search(query, ns, top_k ?? 5, hybrid ?? true);
          return {
            content: [
              { type: "text" as const, text: result || "no results" },
            ],
            details: null,
          };
        } catch (err) {
          return {
            content: [{ type: "text" as const, text: `search failed: ${err}` }],
            details: null,
          };
        }
      },
    })
  );

  pi.registerTool(
    defineTool({
      name: "logos_forget",
      label: "Forget (LogosDB)",
      description:
        "Delete a memory by semantic match. LogosDB finds and removes the closest entry to the query.",
      parameters: Type.Object({
        query: Type.String({ description: "Description of the memory to remove" }),
        namespace: Type.String({ description: "Namespace containing the memory" }),
      }),
      async execute(_id, { query, namespace }) {
        try {
          await client.deleteByQuery(namespace, query);
          return {
            content: [
              { type: "text" as const, text: `deleted → ${namespace}` },
            ],
            details: null,
          };
        } catch (err) {
          return {
            content: [{ type: "text" as const, text: `delete failed: ${err}` }],
            details: null,
          };
        }
      },
    })
  );

  pi.registerTool(
    defineTool({
      name: "logos_namespaces",
      label: "List Namespaces (LogosDB)",
      description: "List all LogosDB memory collections.",
      parameters: Type.Object({}),
      async execute() {
        try {
          const ns = await client.listNamespaces();
          return {
            content: [
              {
                type: "text" as const,
                text:
                  ns.length === 0
                    ? "no collections yet"
                    : ns.join(", "),
              },
            ],
            details: null,
          };
        } catch (err) {
          return {
            content: [{ type: "text" as const, text: `list failed: ${err}` }],
            details: null,
          };
        }
      },
    })
  );

  // ── Commands ─────────────────────────────────────────────────────────────────

  pi.registerCommand("logos-setup", {
    description: "Verify LogosDB MCP server and show configuration",
    handler: async (_args, ctx) => {
      await runSetup(ctx as Parameters<typeof runSetup>[0], client);
    },
  });

  pi.registerCommand("logos-status", {
    description: "Show memory mode, namespace, and indexing state",
    handler: async (_args, ctx) => {
      const ui = (ctx as { ui: { notify(m: string, l?: string): void } }).ui;
      try {
        await client.ensureStarted();
        const nsList = await client.listNamespaces();
        const sessionNs = sessionNamespace(config, projectNs);
        const parts: string[] = [
          `mode=${config.mode}  storing→${sessionNs}  ${indexing ? "indexing…" : "idle"}`,
        ];
        const infoOk = await client.testInfo().catch(() => false);
        for (const ns of nsList) {
          if (infoOk) {
            try {
              const info = await client.infoNamespace(ns);
              parts.push(
                `${ns}: ${info.countLive}/${info.count} live entries  dim=${info.dim}`
              );
            } catch {
              parts.push(`${ns}: (info unavailable)`);
            }
          } else {
            parts.push(ns);
          }
        }
        if (nsList.length === 0) {
          parts.push("(no collections)");
        } else if (!infoOk) {
          parts.push("(entry counts unavailable — Windows mmap limitation in logosdb)");
        }
        ui.notify(parts.join("  |  "), "info");
      } catch {
        ui.notify("memory offline  /logos-setup to diagnose", "warning");
      }
    },
  });

  pi.registerCommand("logos-index", {
    description: "Re-index the current project directory",
    handler: async (_args, ctx) => {
      const ui = (ctx as { ui: { notify(m: string, l?: string): void } }).ui;
      const cwd = process.cwd();
      if (!isIndexableDir(cwd)) {
        ui.notify("no project detected  add .git or package.json", "warning");
        return;
      }
      try {
        await client.ensureStarted();
        await client.indexDirectory(cwd, projectNs);
        ui.notify(`indexed  ${projectNs}`, "info");
      } catch (err) {
        ui.notify(`index failed  ${String(err).split("\n")[0]}`, "error");
      }
    },
  });
}
