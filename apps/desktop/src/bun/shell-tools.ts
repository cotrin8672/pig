import type { Settings } from "../shared/settings";
import { resolveGitBash } from "./git-bash";
import {
  createBashToolDefinition,
  createPowerShellToolDefinition,
} from "./sdk";

export { resolveGitBash };
export function resolvePowerShell(
  which: (name: string) => string | null = Bun.which,
) {
  const path = which("pwsh.exe") ?? which("powershell.exe");
  if (!path)
    throw new Error(
      "PowerShell is selected, but neither pwsh.exe nor powershell.exe was found on PATH.",
    );
  return path;
}
export function shellCommand(
  shell: Settings["shell"],
  path: string,
  command: string,
) {
  return shell === "powershell"
    ? [path, "-NoProfile", "-NonInteractive", "-Command", command]
    : [path, "-c", command];
}
export function desktopShellTool(cwd: string, shell: Settings["shell"]) {
  if (shell === "powershell") {
    resolvePowerShell();
    return createPowerShellToolDefinition(cwd);
  }
  const shellPath = process.platform === "win32" ? resolveGitBash() : undefined;
  if (process.platform === "win32" && !shellPath)
    throw new Error(
      "Git Bash is selected, but Git for Windows' usr/bin/bash.exe was not found. Install Git for Windows.",
    );
  return createBashToolDefinition(cwd, { shellPath });
}
