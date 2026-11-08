import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  defaultSettings,
  type Settings,
  validateSettings,
} from "../shared/settings";
import { desktopConfigDir } from "./desktop-config";

let runtimeSettings = defaultSettings;
export const currentSettings = () => runtimeSettings;
function applyRuntimeSettings(file: string, settings: Settings) {
  if (resolve(file) === resolve(join(desktopConfigDir, "settings.json")))
    runtimeSettings = settings;
  return settings;
}

export async function loadSettings(file: string): Promise<Settings> {
  try {
    return applyRuntimeSettings(
      file,
      validateSettings(JSON.parse(await readFile(file, "utf8"))),
    );
  } catch {
    return applyRuntimeSettings(file, { ...defaultSettings, keybindings: {} });
  }
}
export async function saveSettings(file: string, settings: Settings) {
  const validated = validateSettings(settings);
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(validated));
  await rename(temporary, file);
  applyRuntimeSettings(file, validated);
}
