import { stat } from "node:fs/promises";

// Exact registered scopes only: no descendants, path aliases, or arbitrary cwd.
export async function validateSessionScope(
  cwd: string,
  projects: readonly string[],
  generalCwd: string,
  projectOnly = false,
) {
  if (
    typeof cwd !== "string" ||
    !(projects.includes(cwd) || (!projectOnly && cwd === generalCwd)) ||
    !(await stat(cwd)).isDirectory()
  )
    throw new Error(
      "Choose an existing registered project or general chat directory.",
    );
}
