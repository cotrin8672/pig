import { runCommand } from "./command-executor";
import { resolveGitBash } from "./shell-paths";

/** Only explicit saved/configured values are resolved. Never look up ambient environment keys. */
export async function resolveSavedValue(
  value: string,
  signal?: AbortSignal,
): Promise<string> {
  if (signal?.aborted)
    throw new Error("Saved configuration resolution cancelled");
  if (!value.startsWith("!")) {
    return value.replace(
      /\$\$|\$!|\$\{[A-Za-z_][A-Za-z0-9_]*\}|\$[A-Za-z_][A-Za-z0-9_]*/g,
      (part) => {
        if (part === "$$") return "$";
        if (part === "$!") return "!";
        throw new Error(
          "Environment references in saved configuration are disabled; use a literal or explicit command.",
        );
      },
    );
  }
  try {
    const shell = process.platform === "win32" ? resolveGitBash() : "/bin/sh";
    if (!shell) throw new Error("Saved command shell unavailable");
    // RTK tracks argv. Keep saved source (which may contain tokens) on stdin only.
    const result = await runCommand(shell, ["-s"], {
      signal,
      timeout: 10_000,
      input: `${value.slice(1)}\n`,
    });
    if (result.exitCode !== 0 || !result.stdout.trim())
      throw new Error("Saved command failed");
    return result.stdout.trim();
  } catch {
    // No command source, output, abort reason or exec error cause may reach logs/UI.
    throw new Error("Failed to resolve saved credential/configuration command");
  }
}
