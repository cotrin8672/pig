import { useEffect, useState } from "react";
import type { PiDataReport } from "../shared/pi-data";
import { useT } from "./i18n";
import { SettingsCard } from "./patterns/SettingsCard";
import { SettingsRow } from "./patterns/SettingsRow";
import { rpc } from "./rpc";
import { showError } from "./store";

/** Where Pi data resolves from. */
export function PiDataSettings() {
  const t = useT();
  const [report, setReport] = useState<PiDataReport>();
  useEffect(() => {
    rpc.request.getPiData().then(setReport).catch(showError);
  }, []);
  if (!report) return null;
  const rows = [
    [t.piDataAgentDir, report.agentDir],
    [t.piDataSessions, report.sessionDir],
    [t.piDataModels, report.modelsFile],
  ];
  return (
    <>
      <h3 className="settings-group-title">{t.piDataTitle}</h3>
      <SettingsCard data-setting="pi-data">
        {rows.map(([label, value]) => (
          <SettingsRow key={label} label={label}>
            <code className="settings-path" aria-description={value}>
              {value}
            </code>
          </SettingsRow>
        ))}
      </SettingsCard>
      {report.authState !== "ok" && report.authState !== "missing" && (
        <p className="settings-hint error" role="alert">
          auth.json: {t.piDataState(report.authState)}
        </p>
      )}
    </>
  );
}
