import { existsSync } from "node:fs";
import { win32 } from "node:path";
import type { Settings } from "../shared/settings";
import {
  createBashToolDefinition,
  createPowerShellToolDefinition,
} from "./sdk";

// Bun must launch Git's real executable, not bin/bash.exe's Windows wrapper.
export function resolveGitBash(
  env: NodeJS.ProcessEnv = process.env,
  git: string | null = Bun.which("git"),
  exists: (path: string) => boolean = existsSync,
) {
  return [
    git && win32.resolve(win32.dirname(git), ".."),
    git && win32.resolve(win32.dirname(git), "..", ".."),
    env.LOCALAPPDATA && win32.join(env.LOCALAPPDATA, "Programs", "Git"),
    env.ProgramFiles && win32.join(env.ProgramFiles, "Git"),
    env["ProgramFiles(x86)"] && win32.join(env["ProgramFiles(x86)"], "Git"),
  ]
    .filter((root): root is string => !!root)
    .map((root) => win32.join(root, "usr", "bin", "bash.exe"))
    .find(exists);
}
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
