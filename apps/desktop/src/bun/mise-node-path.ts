import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { basename, delimiter, dirname, isAbsolute } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
const windows = process.platform === "win32";
const node = windows ? "node.exe" : "node";
const mise = windows ? "mise.exe" : "mise";

async function whichMiseNode(
  executable: string,
  options: { cwd: string; env: NodeJS.ProcessEnv },
) {
  const { stdout } = await exec(executable, ["which", "node"], {
    ...options,
    timeout: 1500,
    maxBuffer: 16 * 1024,
    windowsHide: true,
  });
  return stdout;
}

/** Preserve the launcher's PATH and add only the locally installed Node bin. */
export async function addMiseNodeToPath(
  env = process.env,
  home = homedir(),
  resolveNode = whichMiseNode,
) {
  const key = windows
    ? (Object.keys(env).find((key) => key.toUpperCase() === "PATH") ?? "PATH")
    : "PATH";
  const path = env[key] ?? "";
  const search = { PATH: path, cwd: home };
  if (Bun.which(node, search)) return;
  const executable = Bun.which(mise, search);
  if (!executable || !isAbsolute(executable)) return;

  try {
    // Do not load mise configuration from the current chat's project.
    const target = (
      await resolveNode(executable, {
        cwd: home,
        env: {
          ...env,
          MISE_AUTO_INSTALL: "false",
          MISE_NOT_FOUND_AUTO_INSTALL: "false",
          MISE_OFFLINE: "true",
          MISE_YES: "false",
        },
      })
    ).trim();
    const name = basename(target);
    if (
      !isAbsolute(target) ||
      /[\r\n]/.test(target) ||
      (windows ? name.toLowerCase() : name) !== node ||
      !Bun.which(target, { PATH: "" })
    )
      return;
    const bin = dirname(target);
    if (!bin.includes(delimiter))
      env[key] = path ? `${path}${delimiter}${bin}` : bin;
  } catch {
    // Startup can continue without mise or Node.
  }
}
