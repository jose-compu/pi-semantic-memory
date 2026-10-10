import type { LogosDBClient } from "./mcp-client.js";
import { loadConfig } from "./config.js";

export type CommandCtx = {
  ui: { notify(msg: string, level?: "info" | "warning" | "error"): void };
};

export async function runSetup(
  ctx: CommandCtx,
  client: LogosDBClient
): Promise<void> {
  try {
    await client.ensureStarted();
  } catch {
    ctx.ui.notify(
      `memory unavailable  npm i -g logosdb-mcp-server`,
      "error"
    );
    return;
  }

  let count = 0;
  try {
    count = (await client.listNamespaces()).length;
  } catch {
    // non-fatal
  }

  ctx.ui.notify(
    `memory ready  db=${client.dbPath}  ${count} collection${count !== 1 ? "s" : ""}  topK=${loadConfig().topK}`,
    "info"
  );
}
