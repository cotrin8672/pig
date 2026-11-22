import { constants } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

const configOverride = process.env.PIG_DESKTOP_CONFIG_DIR;
export const desktopConfigDir =
  configOverride && isAbsolute(configOverride)
    ? configOverride
    : join(homedir(), ".config", "pig");
export const generalCwd = join(desktopConfigDir, "general");

/** Stable per-installation UUID; OpenAI's ChatGPT sign-in identifies the app host by it. */
export async function deviceId(file = join(desktopConfigDir, "device-id")) {
  const id = crypto.randomUUID();
  try {
    await writeFile(file, id, { flag: "wx" });
    return id;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    return (await readFile(file, "utf8")).trim();
  }
}

export async function prepareDesktopConfig(
  legacyDir: string | undefined,
  destination = desktopConfigDir,
) {
  await mkdir(destination, { recursive: true });
  await mkdir(join(destination, "general"), { recursive: true });
  if (!legacyDir) return;
  for (const name of [
    "projects.json",
    "appearance.json",
    "disabled-models.json",
    "settings.json",
  ]) {
    try {
      await copyFile(
        join(legacyDir, name),
        join(destination, name),
        constants.COPYFILE_EXCL,
      );
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "EEXIST") throw error;
    }
  }
}
