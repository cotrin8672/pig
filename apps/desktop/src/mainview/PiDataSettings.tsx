import { useEffect, useState } from "react";
import type { PiDataReport } from "../shared/pi-data";
import { useT } from "./i18n";
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
      <div className="settings-card" data-setting="pi-data">
        {rows.map(([label, value]) => (
          <div key={label} className="settings-row">
            <div className="settings-label">{label}</div>
            <code className="settings-path" title={value}>
              {value}
            </code>
          </div>
        ))}
      </div>
      {report.authState !== "ok" && report.authState !== "missing" && (
        <p className="settings-hint error" role="alert">
          auth.json: {t.piDataState(report.authState)}
        </p>
      )}
    </>
  );
}
