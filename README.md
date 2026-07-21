<img width="400" height="196" alt="image" src="https://github.com/user-attachments/assets/2d70e60d-3502-49ec-a2b1-2e0235a6dab2" />

# pi-semantic-memory

Local-first semantic memory for [Pi coding agent](https://pi.dev), powered by [LogosDB](https://github.com/jose-compu/logosdb).

Vector search runs entirely on your machine — no cloud, no external API, stdio-only.

## Install

```sh
pi install npm:pi-semantic-memory
```

Verify setup:

```
/logos-setup
```

## Requirements

`logosdb-mcp-server` must be reachable. Install globally for best performance:

```sh
npm install -g logosdb-mcp-server
```

Falls back to `npx --yes logosdb-mcp-server` if not found in PATH.

## What happens automatically

| Event | Action |
|---|---|
| **Session start** | Background-indexes the project directory (incremental, honours `.gitignore`) |
| **Every user prompt** | Semantic search → injects relevant memories into the system prompt silently |
| **After each agent turn** | Persists a turn record (Q+A) to memory; incremental re-index for changed files |
| **Session compaction** | Stores a handoff note |

All automatic actions are silent — nothing is printed to the console.

## Memory scope

Controlled by `LOGOS_MEMORY_MODE` (default: `global`).

### `global` (default)

Turn records are stored in **`pi-global`** and are visible across **all sessions and all projects**.  
Context injection searches both `pi-global` and the current project namespace.

```sh
# default — no env var needed
pi
```

### `project`

Turn records and searches are isolated to the **current project namespace** (`pi-proj-<name>`).  
Each repo has its own independent memory.

```sh
LOGOS_MEMORY_MODE=project pi
```

Or add to your shell profile / Pi config:

```sh
export LOGOS_MEMORY_MODE=project
```

## Namespaces

| Namespace | Purpose |
|---|---|
| `pi-global` | Cross-project memories (default store for turn records in global mode) |
| `pi-proj-<name>` | Project-specific memory and indexed source files; auto-derived from `cwd` basename |

## Tools

| Tool | Description |
|---|---|
| `logos_remember` | Store a memory in a namespace |
| `logos_recall` | Semantic search across a namespace |
| `logos_forget` | Delete by semantic match |
| `logos_namespaces` | List all collections |

## Commands

| Command | Description |
|---|---|
| `/logos-setup` | Verify MCP server and print configuration |
| `/logos-status` | Show mode, active namespace, indexing state |
| `/logos-index` | Manually trigger incremental re-indexing of the current directory |

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `LOGOS_MEMORY_MODE` | `global` | `global` or `project` — controls memory scope |
| `LOGOSDB_PATH` | `~/.pi/agent/logosdb` | Path to the LogosDB database directory |
| `LOGOSDB_MCP_BIN` | _(auto)_ | Override the `logosdb-mcp-server` binary path |

## Changelog

See [CHANGELOG.md](./CHANGELOG.md). Latest: **1.0.2** — pending MCP RPCs are rejected immediately when the server process exits.

## License

MIT
