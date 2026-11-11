import { useEffect } from "react";
import { useT } from "./i18n";
import { rpc } from "./rpc";
import { showError, useStore } from "./store";

export function AppUpdateSettings() {
  const t = useT();
  const state = useStore((s) => s.appUpdate);
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
  const reason =
    state.reason &&
    {
      nightly: t.appUpdateNightly,
      development: t.appUpdateDevelopment,
      unsupported: t.appUpdateUnsupported,
      unknown: t.appUpdateUnknown,
    }[state.reason];
  const status = {
    idle: "",
    checking: t.appUpdateChecking,
    current: t.appUpdateCurrent,
    available: state.latest ? t.appUpdateAvailable(state.latest) : "",
    preparing: t.appUpdatePreparing,
    restarting: t.appUpdateRestarting,
    error: "",
  }[state.status];
  return (
    <section className="settings-card" aria-label={t.appUpdateTitle}>
      <div className="settings-row">
        <div className="settings-label">{t.appUpdateVersion}</div>
        <code>{state.version}</code>
      </div>
      <div className="settings-row">
        <div className="settings-label">{t.appUpdateMethod}</div>
        <span>
          {state.method === "scoop"
            ? "Scoop"
            : state.method === "portable"
              ? "Portable"
              : "—"}
        </span>
      </div>
      <p className="muted">{t.appUpdateStableOnly}</p>
      {reason && <p className="muted">{reason}</p>}
      <p role="status" aria-live="polite">
        {status}
      </p>
      {state.error && (
        <p className="error" role="alert">
          {state.error}
        </p>
      )}
      {state.method !== "disabled" && (
        <div className="settings-row">
          <button
            type="button"
            disabled={busy}
            onClick={() => rpc.send.checkAppUpdate()}
          >
            {t.appUpdateCheck}
          </button>
          {state.latest && (
            <button
              type="button"
              disabled={busy}
              onClick={() => rpc.send.installAppUpdate()}
            >
              {t.appUpdateRestart}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
