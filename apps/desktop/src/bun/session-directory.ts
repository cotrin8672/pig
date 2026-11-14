import { join, resolve } from "node:path";

/**
 * Pi's per-cwd default without the SDK helper's mkdir side effect.
 * Mirrors getDefaultSessionDirPath in SDK 1.5.2; checked against the SDK in tests.
 */
export function defaultSessionDir(cwd: string, agentDir: string) {
  const safe = `--${resolve(cwd)
    .replace(/^[/\\]/, "")
    .replace(/[/\\:]/g, "-")}--`;
  return join(resolve(agentDir), "sessions", safe);
}
