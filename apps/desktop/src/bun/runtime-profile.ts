import { homedir } from "node:os";
import { join } from "node:path";
import { desktopConfigDir } from "./desktop-config";
import { getAgentDir } from "./sdk";

/** Pi's standard resolution (PI_CODING_AGENT_DIR, else ~/.pi/agent) via the
 * SDK itself. pig never writes the variable: CLI and GUI share one
 * auth/models/settings/sessions/resources profile.
 */
export const agentDir = getAgentDir();
export const agentDirSource: "env" | "default" = process.env.PI_CODING_AGENT_DIR
  ? "env"
  : "default";
/** v0.2/v0.3 forced this private profile; it is only read for opt-in import. */
export const legacyAgentDir = join(desktopConfigDir, "pi-agent");

/** Same `~` expansion the SDK applies to PI_CODING_AGENT_SESSION_DIR. */
export function expandHome(path: string) {
  if (path === "~") return homedir();
  if (path.startsWith("~/") || path.startsWith("~\\"))
    return join(homedir(), path.slice(2));
  return path;
}
