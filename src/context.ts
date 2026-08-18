/**
 * Context injection and session memory helpers.
 */

import type { LogosDBClient } from "./mcp-client.js";
import type { MemoryConfig } from "./config.js";
import { sessionNamespace } from "./config.js";

export const GLOBAL_NS = "pi-global";
export const TOP_K = 5;

/**
 * Derive a deterministic project-scoped namespace from the working directory.
 * Format: pi-proj-<basename> (max 48 chars, lowercase, alphanumeric + hyphens).
 */
export function deriveProjectNamespace(cwd: string): string {
  const base =
    cwd
      .split("/")
      .filter(Boolean)
      .pop()
      ?.toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32) ?? "default";
  return `pi-proj-${base}`;
}

/**
 * Extract a search query from the agent event context.
 * Prefers the last user message; falls back to a prefix of systemPrompt.
 */
export function extractQuery(
  messages: Array<{ role: string; content: unknown }>,
  systemPrompt: string
): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== "user") continue;
    const text = extractText(msg.content);
    if (text.trim()) return text.slice(0, 512);
  }
  return systemPrompt.slice(0, 256);
}

/**
 * Query LogosDB for relevant context and return a system-prompt appendix.
 * Returns null when there is nothing useful to inject.
 *
 * global mode  → searches pi-global + project namespace
 * project mode → searches project namespace only
 */
export async function buildMemoryContext(
  client: LogosDBClient,
  query: string,
  projectNs: string,
  config: MemoryConfig,
  topK = TOP_K,
  hybrid = true
): Promise<string | null> {
  if (config.mode === "project") {
    let result: string;
    try {
      result = (await client.search(query, projectNs, topK, hybrid)).trim();
    } catch {
      return null;
    }
    if (!result) return null;
    return `\n\n<memory>\n${result}\n</memory>`;
  }

  // global mode: search both namespaces in parallel
  const [globalSettled, projectSettled] = await Promise.allSettled([
    client.search(query, GLOBAL_NS, topK, hybrid),
    projectNs !== GLOBAL_NS
      ? client.search(query, projectNs, topK, hybrid)
      : Promise.resolve(""),
  ]);

  const global =
    globalSettled.status === "fulfilled" ? globalSettled.value.trim() : "";
  const project =
    projectSettled.status === "fulfilled" ? projectSettled.value.trim() : "";

  if (!global && !project) return null;

  const parts: string[] = ["\n\n<memory>"];
  if (global) parts.push(global);
  if (project) parts.push(project);
  parts.push("</memory>");
  return parts.join("\n");
}

/**
 * Persist a compact record of the completed agent turn, including thinking
 * traces when the model produced them (non-redacted only).
 *
 * Called on agent_end. Runs in background — never throws to the caller.
 * Skips turns where there is neither assistant text nor thinking content
 * (pure tool-batch turns with no reasoning or prose).
 */
export async function storeTurnMemory(
  messages: Array<{ role: string; content: unknown }>,
  client: LogosDBClient,
  projectNs: string,
  config: MemoryConfig,
  cwd: string
): Promise<void> {
  const userText = lastText(messages, "user");
  if (!userText) return;

  const assistantText = lastAssistantText(messages);
  const thinkingText = lastThinkingText(messages);

  // Skip turns with neither prose nor reasoning traces.
  if (!assistantText && !thinkingText) return;

  const ts = new Date().toISOString().slice(0, 16).replace("T", " ");
  const dir = cwd.split("/").filter(Boolean).slice(-2).join("/");

  const parts: string[] = [
    `[${ts}] ${dir}`,
    `Q: ${userText.slice(0, 300)}`,
  ];

  if (thinkingText) {
    parts.push(`<thinking>\n${thinkingText.slice(0, 800)}\n</thinking>`);
  }

  if (assistantText) {
    parts.push(`A: ${assistantText.slice(0, 500)}`);
  }

  const ns = sessionNamespace(config, projectNs);
  await client.index(parts.join("\n"), ns, "session-turn");
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function extractText(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return (content as Array<{ type?: string; text?: string }>)
      .filter((p) => p.type === "text")
      .map((p) => p.text ?? "")
      .join(" ")
      .trim();
  }
  return "";
}

function lastText(
  messages: Array<{ role: string; content: unknown }>,
  role: string
): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role !== role) continue;
    const t = extractText(messages[i].content);
    if (t) return t;
  }
  return "";
}

function lastAssistantText(
  messages: Array<{ role: string; content: unknown }>
): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== "assistant") continue;
    const content = msg.content;
    if (!Array.isArray(content)) continue;
    const text = (content as Array<{ type?: string; text?: string }>)
      .filter((p) => p.type === "text")
      .map((p) => p.text ?? "")
      .join(" ")
      .trim();
    if (text) return text;
  }
  return "";
}

/**
 * Extract the last non-redacted thinking trace from assistant messages.
 * ThinkingContent: { type: "thinking"; thinking: string; redacted?: boolean }
 */
function lastThinkingText(
  messages: Array<{ role: string; content: unknown }>
): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== "assistant") continue;
    const content = msg.content;
    if (!Array.isArray(content)) continue;
    const thinking = (
      content as Array<{ type?: string; thinking?: string; redacted?: boolean }>
    )
      .filter((p) => p.type === "thinking" && !p.redacted && p.thinking?.trim())
      .map((p) => p.thinking ?? "")
      .join("\n")
      .trim();
    if (thinking) return thinking;
  }
  return "";
}
