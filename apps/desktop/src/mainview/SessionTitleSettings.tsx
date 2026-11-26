import { defaultAccountModels, modelKey } from "../shared/models";
import { npmName } from "../shared/packages";
import { ARCHIMEDES_SESSION_NAME } from "../shared/supported-extensions";
import { useT } from "./i18n";
import { SettingsCard } from "./patterns/SettingsCard";
import { rpc } from "./rpc";
import { useStore } from "./store";
import { ModelSelect } from "./UtilityModelSettings";
import { sessionTitlePreference } from "./ui-mutations";

const setting = "session-title-model";

export function SessionTitleSettings() {
  const t = useT();
  const bootstrap = useStore((s) => s.bootstrap);
  const installed = useStore((s) =>
    s.installed.some(
      (pkg) =>
        pkg.scope === "user" &&
        (pkg.name === ARCHIMEDES_SESSION_NAME ||
          npmName(pkg.source) === ARCHIMEDES_SESSION_NAME),
    ),
  );
  if (!installed)
    return (
      <SettingsCard
        className="utility-model-select"
        data-setting={setting}
        tabIndex={-1}
        aria-labelledby={`${setting}-label`}
        aria-describedby={`${setting}-hint`}
      >
        <strong id={`${setting}-label`}>{t.sessionTitleModel}</strong>
        <p id={`${setting}-hint`} className="settings-hint">
          {t.sessionTitleInstall}
        </p>
      </SettingsCard>
    );

  const models = defaultAccountModels(bootstrap);
  const reference = bootstrap.sessionTitleModel ?? null;
  const value = reference
    ? (models.find(
        (model) => modelKey(model).toLowerCase() === reference.toLowerCase(),
      ) ?? reference)
    : null;
  return (
    <>
      <ModelSelect
        label={t.sessionTitleModel}
        setting={setting}
        models={models}
        value={value}
        emptyLabel={t.sessionTitleChatModel}
        onChange={(model) => {
          void sessionTitlePreference.change(
            setting,
            useStore.getState().bootstrap.sessionTitleModel ?? null,
            model ? modelKey(model) : null,
            (sessionTitleModel) =>
              useStore.setState((s) => ({
                bootstrap: { ...s.bootstrap, sessionTitleModel },
              })),
            () => rpc.request.setSessionTitleModel({ model }),
          );
        }}
      />
      <p className="settings-hint">{t.sessionTitleDisclosure}</p>
    </>
  );
}
