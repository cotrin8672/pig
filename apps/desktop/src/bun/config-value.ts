import { execFile } from "node:child_process";
import { resolveGitBash } from "./git-bash";

/** Only explicit saved/configured values are resolved. Never look up ambient environment keys. */
export async function resolveSavedValue(
  value: string,
  signal?: AbortSignal,
): Promise<string> {
  signal?.throwIfAborted();
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
  return new Promise((resolve, reject) => {
    const shell = process.platform === "win32" ? resolveGitBash() : "/bin/sh";
    if (!shell)
      return reject(
        new Error(
          "Git Bash is required to resolve saved configuration commands, but Git for Windows' usr/bin/bash.exe was not found. Install Git for Windows.",
        ),
      );
    execFile(
      shell,
      ["-c", value.slice(1)],
      { signal, timeout: 10_000, windowsHide: true },
      (error, stdout) => {
        if (error || !stdout.trim())
          reject(
            new Error(
              "Failed to resolve saved credential/configuration command",
              { cause: error },
            ),
          );
        else resolve(stdout.trim());
      },
    );
  });
}
