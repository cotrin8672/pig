import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getAgentDir, SettingsManager } from "@earendil-works/pi-coding-agent";
import type { ModelOverride } from "../shared/model-overrides";
import { modelKey } from "../shared/models";
import type { Effort } from "../shared/rpc-schema";

type ModelsJson = {
  providers?: Record<
    string,
    { modelOverrides?: Record<string, ModelOverride> } & Record<string, unknown>
  >;
} & Record<string, unknown>;

export const modelsJsonPath = () => join(getAgentDir(), "models.json");

async function readModelsJson(file: string): Promise<ModelsJson> {
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
  } catch {}
  // pi accepts JSONC; rewriting it would drop the user's comments.
  throw new Error(
    `Cannot edit ${file}: it is not plain JSON (comments?). Edit it manually.`,
  );
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
    await rename(temporary, file);
  });
  queue = run.catch(() => {});
  return run;
}

// Global pi settings (shared with the pi CLI); agentDir as cwd skips project settings.
let piSettings: SettingsManager | undefined;
export function settings() {
  piSettings ??= SettingsManager.create(getAgentDir(), getAgentDir());
  return piSettings;
}
export async function writeDefaultEffort(
  provider: string,
  id: string,
  effort: Effort | null,
) {
  const manager = settings();
  await manager.reload();
  if (effort) manager.setModelThinkingLevel(provider, id, effort);
  else manager.removeModelThinkingLevel(provider, id);
  await manager.flush();
  const [error] = manager.drainErrors();
  if (error) throw new Error(`Cannot save pi settings: ${error.error.message}`);
}
