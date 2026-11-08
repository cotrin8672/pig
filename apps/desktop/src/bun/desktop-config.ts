import { constants } from "node:fs";
import { copyFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export const desktopConfigDir = join(homedir(), ".config", "pig");
export const generalCwd = join(desktopConfigDir, "general");

export async function prepareDesktopConfig(
  legacyDir: string,
  destination = desktopConfigDir,
) {
  await mkdir(destination, { recursive: true });
  await mkdir(join(destination, "general"), { recursive: true });
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
