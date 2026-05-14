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
}

export function loadConfig(): MemoryConfig {
  return {
    mode: process.env.LOGOS_MEMORY_MODE === "project" ? "project" : "global",
  };
}

/** Namespace that receives automatic turn memories. */
export function sessionNamespace(config: MemoryConfig, projectNs: string): string {
  return config.mode === "project" ? projectNs : "pi-global";
}
