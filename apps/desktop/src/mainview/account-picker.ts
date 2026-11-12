import {
  type AccountSource,
  accountSourceKey,
  providerAccountSources,
} from "../shared/account-models";
import { filterModels } from "../shared/models";
import type { Bootstrap, ModelInfo, Snapshot } from "../shared/rpc-schema";

export type ModelSource = AccountSource & { models: ModelInfo[] };
export type AccountModel = { source: ModelSource; model: ModelInfo };

/** Catalog and auth are account-scoped, visibility/effort preferences stay Provider-scoped. */
export function accountModelSources(
  bootstrap: Bootstrap,
  snapshot?: Snapshot,
): ModelSource[] {
  const providers = [...bootstrap.providers];
  for (const model of snapshot?.modelCatalog ?? bootstrap.models) {
    if (!providers.some((p) => p.id === model.provider))
      providers.push({
        id: model.provider,
        name: model.provider,
        configured: true,
        stored: false,
        apiKey: false,
        extension: true,
      });
  }
  return providers.flatMap((provider) =>
    providerAccountSources(provider).flatMap((source) => {
      const selectedId =
        snapshot?.sessionAccounts?.[source.provider] ??
        (snapshot?.model?.provider === source.provider
          ? snapshot.accountId
          : undefined);
      const local = snapshot?.modelCatalog && selectedId === source.accountId;
      const catalog = local
        ? snapshot.modelCatalog
        : (bootstrap.accountCatalogs?.[
            accountSourceKey(source.provider, source.accountId)
          ] ?? (source.accountId ? [] : bootstrap.models));
      const models = filterModels(
        (catalog ?? []).filter((model) => model.provider === source.provider),
        bootstrap.disabledModels,
      );
      // Project extensions can authenticate a canonical Provider only in this chat.
      const configured =
        source.configured ||
        !!(
          local &&
          !source.accountId &&
          catalog?.some((model) => model.provider === source.provider)
        );
      return models.length || source.accountId || provider.accounts?.length
        ? [{ ...source, configured, models }]
        : [];
    }),
  );
}
export function accountLocked(source: AccountSource, snapshot?: Snapshot) {
  if (snapshot?.accountSwitchAllowed !== false) return false;
  const selected =
    snapshot.sessionAccounts?.[source.provider] ??
    (snapshot.model?.provider === source.provider
      ? snapshot.accountId
      : undefined);
  return selected !== source.accountId;
}
