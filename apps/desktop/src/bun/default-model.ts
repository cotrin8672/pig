import type { DefaultModel } from "../shared/rpc-schema";
import { generalCwd } from "./desktop-config";
import { agentDir } from "./runtime-profile";
import { SettingsManager } from "./sdk";

function checkErrors(settings: ReturnType<typeof SettingsManager.create>) {
  const errors = settings.drainErrors();
  if (errors.length)
    throw new Error(
      errors.map((e) => `${e.path ?? e.scope}: ${e.error.message}`).join("; "),
    );
}
function globalSettings(directory: string) {
  const settings = SettingsManager.create(generalCwd, directory, {
    projectTrusted: false,
  });
  checkErrors(settings);
  return settings;
}

export function readDefaultModel(directory = agentDir): DefaultModel {
  const { defaultProvider, defaultModel } =
    globalSettings(directory).getGlobalSettings();
  return defaultProvider && defaultModel
    ? { provider: defaultProvider, id: defaultModel }
    : null;
}

export async function writeDefaultModel(
  model: DefaultModel,
  enabledModels: readonly Exclude<DefaultModel, null>[],
  directory = agentDir,
): Promise<DefaultModel> {
  if (
    model !== null &&
    (!model ||
      typeof model.provider !== "string" ||
      typeof model.id !== "string" ||
      !enabledModels.some(
        (item) => item.provider === model.provider && item.id === model.id,
      ))
  )
    throw new Error("Choose an available, enabled model.");
  const settings = globalSettings(directory);
  // Empty defaults restore the SDK's automatic model selection.
  settings.setDefaultModelAndProvider(model?.provider ?? "", model?.id ?? "");
  await settings.flush();
  checkErrors(settings);
  return model;
}
