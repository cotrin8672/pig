import type { ModelInfo, ModelSelection, ProviderInfo } from "./rpc-schema";

/** UI identity only; never use this key as an SDK Provider ID. */
export const accountSourceKey = (provider: string, accountId?: string) =>
  JSON.stringify([provider, accountId ?? null]);
export type AccountSource = {
  key: string;
  provider: string;
  accountId?: string;
  label: string;
  configured: boolean;
};
export function providerAccountSources(
  provider: ProviderInfo,
): AccountSource[] {
  return [
    {
      key: accountSourceKey(provider.id),
      provider: provider.id,
      label:
        provider.accountLabel ??
        (provider.accounts?.length ? `${provider.name} 1` : provider.name),
      configured: provider.configured,
    },
    ...(provider.accounts ?? []).map((account) => ({
      key: accountSourceKey(provider.id, account.id),
      provider: provider.id,
      accountId: account.id,
      label: account.label,
      configured: account.configured,
    })),
  ];
}
/** Keep existing "provider/model" recent keys for standard pi credentials. */
export const accountModelKey = (
  model: Pick<ModelInfo, "provider" | "id">,
  accountId?: string,
) =>
  accountId
    ? JSON.stringify([model.provider, model.id, accountId])
    : `${model.provider}/${model.id}`;
export const selectionKey = (selection: ModelSelection) =>
  selection.model ? accountModelKey(selection.model, selection.accountId) : "";
