import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { desktopConfigDir, generalCwd } from "./desktop-config";
import { resetExtensionProviders } from "./model-runtime";
import { desktopResourceOptions } from "./resources";
import { agentDir } from "./runtime-profile";
import { createAgentSessionServices, SettingsManager } from "./sdk";

/** Loads only user-scope factories/providers, never the currently selected project.
 * No AgentSession/session_start, tools, model request or official CLI profile.
 */
export async function reloadUserCatalog(runtime: ModelRuntime) {
  await resetExtensionProviders(runtime);
  return createAgentSessionServices({
    cwd: generalCwd,
    agentDir,
    modelRuntime: runtime,
    settingsManager: SettingsManager.create(generalCwd, agentDir, {
      projectTrusted: false,
    }),
    resourceLoaderOptions: await desktopResourceOptions(
      generalCwd,
      false,
      desktopConfigDir,
    ),
    resourceLoaderReloadOptions: { resolveProjectTrust: async () => false },
  });
}
