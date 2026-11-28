import { readFile } from "node:fs/promises";
import { defaultAppearance, validateAppearance } from "../shared/appearance";
import type { Appearance } from "../shared/rpc-schema";
import { writeAtomicJson } from "./atomic-json";

export { validateAppearance } from "../shared/appearance";

export async function loadAppearance(file: string): Promise<Appearance> {
  try {
    return validateAppearance(JSON.parse(await readFile(file, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      console.error("Cannot load appearance:", error);
    return { ...defaultAppearance, opacity: { ...defaultAppearance.opacity } };
  }
}

export const saveAppearance = (file: string, appearance: Appearance) =>
  writeAtomicJson(file, appearance);
