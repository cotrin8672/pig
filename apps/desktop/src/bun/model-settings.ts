import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ModelOverride } from "../shared/model-overrides";
import { modelKey } from "../shared/models";
import type { Effort } from "../shared/rpc-schema";
import { desktopConfigDir } from "./desktop-config";
import { agentDir } from "./runtime-profile";

type ModelsJson = {
  providers?: Record<
    string,
    { modelOverrides?: Record<string, ModelOverride> } & Record<string, unknown>
  >;
} & Record<string, unknown>;

/** Pi's standard models.json, shared with the CLI. */
export const modelsJsonPath = () => join(agentDir, "models.json");

async function rawText(file: string) {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export async function readModelsJson(
  file = modelsJsonPath(),
): Promise<ModelsJson> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
  try {
    const parsed = JSON.parse(text.replace(/^\uFEFF/, ""));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
      return parsed;
  } catch {
    /* Not plain JSON: refuse below instead of rewriting. */
  }
  // pi accepts JSONC; rewriting it would drop the user's comments.
  throw new Error(
    `Cannot edit ${file}: it is not plain JSON (comments?). Edit it manually.`,
  );
}

/** Startup accepts the SDK's JSONC format; the editor still refuses comment-destructive rewrites. */
export async function readModelConfig(
  file = modelsJsonPath(),
): Promise<unknown> {
  try {
    return Bun.JSONC.parse(
      (await readFile(file, "utf8")).replace(/^\uFEFF/, ""),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}
export async function readModelOverrides(file = modelsJsonPath()) {
  const result: Record<string, ModelOverride> = {};
  for (const [provider, config] of Object.entries(
    (await readModelsJson(file)).providers ?? {},
  ))
    for (const [id, override] of Object.entries(config?.modelOverrides ?? {}))
      result[modelKey({ provider, id })] = override;
  return result;
}

let queue = Promise.resolve();
// Replaces one model's override; an empty override removes the entry.
export function writeModelOverride(
  provider: string,
  id: string,
  override: ModelOverride,
  file = modelsJsonPath(),
) {
  const run = queue.then(async () => {
    const before = await rawText(file);
    const json = await readModelsJson(file);
    json.providers ??= {};
    json.providers[provider] ??= {};
    const config = json.providers[provider];
    config.modelOverrides ??= {};
    const overrides = config.modelOverrides;
    if (Object.keys(override).length) overrides[id] = override;
    else delete overrides[id];
    if (!Object.keys(overrides).length) delete config.modelOverrides;
    if (!Object.keys(config).length) delete json.providers[provider];
    await mkdir(dirname(file), { recursive: true });
    const temporary = `${file}.${crypto.randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(json, null, 2)}\n`);
    // The CLI or an editor may share this file; never replace a newer version.
    if ((await rawText(file)) !== before) {
      await unlink(temporary);
      throw new Error(`${file} changed on disk; reload and retry`);
    }
    await rename(temporary, file);
  });
  queue = run.catch(() => {});
  return run;
}

const effortFile = join(desktopConfigDir, "model-efforts.json");
let efforts: Record<string, Effort> = {};
export async function loadEfforts() {
  try {
    efforts = JSON.parse(await readFile(effortFile, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
export function defaultEffort(provider: string, id: string) {
  return efforts[modelKey({ provider, id })];
}
export function writeDefaultEffort(
  provider: string,
  id: string,
  effort: Effort | null,
) {
  const run = queue.then(async () => {
    const next = { ...efforts };
    const key = modelKey({ provider, id });
    if (effort) next[key] = effort;
    else delete next[key];
    await mkdir(desktopConfigDir, { recursive: true });
    const temporary = `${effortFile}.${crypto.randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(next));
    await rename(temporary, effortFile);
    efforts = next;
  });
  queue = run.catch(() => {});
  return run;
}
