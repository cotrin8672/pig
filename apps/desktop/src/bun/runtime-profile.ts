import { join } from "node:path";
import { desktopConfigDir } from "./desktop-config";

/** Fixed once, before the SDK module graph is evaluated; never session-scoped. */
export const agentDir = join(desktopConfigDir, "pi-agent");
process.env.PI_CODING_AGENT_DIR = agentDir;
