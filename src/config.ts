/**
 * Memory scope configuration.
 *
 * LOGOS_MEMORY_MODE=global   (default)
 *   Turn records are stored in "pi-global" — visible across ALL sessions and projects.
 *   Context injection searches both pi-global and the current project namespace.
 *
 * LOGOS_MEMORY_MODE=project
 *   Turn records are stored in the current project namespace only.
 *   Context injection searches only the project namespace.
 *   Each repo/project has fully isolated memory.
 */

export type MemoryMode = "global" | "project";

export interface MemoryConfig {
  mode: MemoryMode;
  /** Results injected on each prompt. Default 5; override with LOGOS_TOP_K (1–50). */
  topK: number;
}

const DEFAULT_TOP_K = 5;
const MAX_TOP_K = 50;

export function parseTopK(raw: string | undefined): number {
  if (raw == null || raw.trim() === "") return DEFAULT_TOP_K;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > MAX_TOP_K) return DEFAULT_TOP_K;
  return n;
}

export function loadConfig(): MemoryConfig {
  return {
    mode: process.env.LOGOS_MEMORY_MODE === "project" ? "project" : "global",
    topK: parseTopK(process.env.LOGOS_TOP_K),
  };
}

/** Namespace that receives automatic turn memories. */
export function sessionNamespace(config: MemoryConfig, projectNs: string): string {
  return config.mode === "project" ? projectNs : "pi-global";
}
