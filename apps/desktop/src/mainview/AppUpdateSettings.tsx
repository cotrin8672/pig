import { useEffect } from "react";
import { useT } from "./i18n";
import { SettingsCard } from "./patterns/SettingsCard";
import { SettingsRow } from "./patterns/SettingsRow";
import { Button } from "./primitives/Button";
import { Switch } from "./primitives/Switch";
import { rpc, updateSettings } from "./rpc";
import { showError, useStore } from "./store";

export function AppUpdateSettings() {
  const t = useT();
  const state = useStore((s) => s.appUpdate);
  const includeNightly = useStore((s) => s.settings.includeNightly);
  useEffect(() => {
    void rpc.request
      .getAppUpdate()
      .then((appUpdate) => {
        // An update event may arrive while the initial request is in flight.
        useStore.setState((s) => (s.appUpdate ? {} : { appUpdate }));
      })
      .catch(showError);
  }, []);
  if (!state) return null;
  const busy = ["checking", "preparing", "restarting"].includes(state.status);
  const available = Boolean(state.latest);
  const status =
    state.error ??
    (state.reason &&
      {
        nightly: t.appUpdateNightly,
        development: t.appUpdateDevelopment,
        unsupported: t.appUpdateUnsupported,
        unknown: t.appUpdateUnknown,
      }[state.reason]) ??
    {
      idle: "",
      checking: t.appUpdateChecking,
      current: t.appUpdateCurrent,
      available: state.latest ? t.appUpdateAvailable(state.latest) : "",
      preparing: t.appUpdatePreparing,
      restarting: t.appUpdateRestarting,
      error: "",
    }[state.status];
  return (
    <SettingsCard aria-label={t.appUpdateTitle}>
      {state.method === "installer" && (
        <SettingsRow label={t.appUpdateIncludeNightly}>
          <label>
            <Switch
              aria-label={t.appUpdateIncludeNightly}
              checked={includeNightly}
              disabled={busy}
              onChange={(event) =>
                updateSettings({ includeNightly: event.target.checked })
              }
            />
          </label>
        </SettingsRow>
      )}
      <SettingsRow
        className="app-update"
        setting="app-update"
        label={
          <>
            <div>
              pig <span className="app-update-version">{state.version}</span>
            </div>
            <div
              className="app-update-status"
              data-error={state.error ? "" : undefined}
              role={state.error ? "alert" : "status"}
              aria-live="polite"
            >
              {status}
            </div>
          </>
        }
      >
        {state.method !== "disabled" && (
          <Button
            variant={available ? "primary" : "secondary"}
            disabled={busy}
            onClick={() =>
              available
                ? rpc.send.installAppUpdate()
                : rpc.send.checkAppUpdate()
            }
          >
            {available ? t.appUpdateRestart : t.appUpdateCheck}
          </Button>
        )}
      </SettingsRow>
    </SettingsCard>
  );
}
