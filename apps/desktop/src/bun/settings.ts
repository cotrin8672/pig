import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  defaultSettings,
  type Settings,
  validateSettings,
} from "../shared/settings";
import { writeAtomicJson } from "./atomic-json";
import { desktopConfigDir } from "./desktop-config";

let runtimeSettings = defaultSettings;
export const currentSettings = () => runtimeSettings;
function applyRuntimeSettings(file: string, settings: Settings) {
  if (resolve(file) === resolve(join(desktopConfigDir, "settings.json")))
    runtimeSettings = settings;
  return settings;
}

export async function loadSettings(
  file: string,
  defaultShell: Settings["shell"] = defaultSettings.shell,
): Promise<Settings> {
  try {
    return applyRuntimeSettings(
      file,
      validateSettings(JSON.parse(await readFile(file, "utf8")), defaultShell),
    );
  } catch {
    return applyRuntimeSettings(file, {
      ...defaultSettings,
      shell: defaultShell,
      keybindings: {},
    });
  }
}
export async function saveSettings(file: string, settings: Settings) {
  const validated = validateSettings(settings);
  await writeAtomicJson(file, validated);
  applyRuntimeSettings(file, validated);
}
