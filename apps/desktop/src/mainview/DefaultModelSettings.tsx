import { accountSourceKey } from "../shared/account-models";
import { filterModels } from "../shared/models";
import { useT } from "./i18n";
import { rpc } from "./rpc";
import { useStore } from "./store";
import { ModelSelect } from "./UtilityModelSettings";
import { defaultModelPreference } from "./ui-mutations";

export function DefaultModelSettings() {
  const t = useT();
  const {
    models,
    disabledModels,
    accountCatalogs,
    defaultModel = null,
  } = useStore((s) => s.bootstrap);
  return (
    <>
      <ModelSelect
        label={t["Default model"]}
        setting="default-model"
        models={filterModels(models, disabledModels).filter(
          (model) =>
            !accountCatalogs ||
            accountCatalogs[accountSourceKey(model.provider)]?.some(
              (entry) => entry.id === model.id,
            ),
        )}
        value={defaultModel}
        emptyLabel={t.Automatic}
        onChange={(model) => {
          void defaultModelPreference.change(
            "default",
            defaultModel,
            model,
            (value) =>
              useStore.setState((state) => ({
                bootstrap: { ...state.bootstrap, defaultModel: value },
              })),
            () => rpc.request.setDefaultModel({ model }),
          );
        }}
      />
      <p className="settings-hint">
        {t["Used for new chats. Existing chats keep their model."]}
      </p>
    </>
  );
}
