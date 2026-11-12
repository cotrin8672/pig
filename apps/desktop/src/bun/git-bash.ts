import { existsSync } from "node:fs";
import { win32 } from "node:path";

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
