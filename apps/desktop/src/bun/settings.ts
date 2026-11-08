import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  defaultSettings,
  type Settings,
  validateSettings,
} from "../shared/settings";

export async function loadSettings(file: string): Promise<Settings> {
  try {
    return validateSettings(JSON.parse(await readFile(file, "utf8")));
  } catch {
    return { ...defaultSettings, keybindings: {} };
  }
}
export async function saveSettings(file: string, settings: Settings) {
  const validated = validateSettings(settings);
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(validated));
  await rename(temporary, file);
}
