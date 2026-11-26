import { accountSourceKey } from "./account-models";
import type { Bootstrap, ModelInfo } from "./rpc-schema";

export const modelKey = (model: Pick<ModelInfo, "provider" | "id">) =>
  `${model.provider}/${model.id}`;
export const isModelEnabled = (model: ModelInfo, disabled: readonly string[]) =>
  !disabled.includes(modelKey(model));

export function filterModels(
  models: ModelInfo[],
  disabled: readonly string[],
  query = "",
) {
  const search = query.trim().toLowerCase();
  return models.filter(
    (model) =>
      isModelEnabled(model, disabled) &&
      `${model.name} ${model.id} ${model.provider}`
        .toLowerCase()
        .includes(search),
  );
}

export function defaultAccountModels({
  models,
  disabledModels,
  accountCatalogs,
}: Bootstrap) {
  return filterModels(models, disabledModels).filter(
    (model) =>
      !accountCatalogs ||
      accountCatalogs[accountSourceKey(model.provider)]?.some(
        (entry) => entry.id === model.id,
      ),
  );
}

export function replaceModelVisibility(
  current: readonly string[],
  keys: readonly string[],
  disabled: readonly string[],
) {
  const affected = new Set(keys);
  return [
    ...current.filter((key) => !affected.has(key)),
    ...disabled.filter((key) => affected.has(key)),
  ];
}
