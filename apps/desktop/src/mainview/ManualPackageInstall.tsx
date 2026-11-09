import { Download, LoaderCircle } from "lucide-react";
import { useId, useRef } from "react";
import type { PackageOpStatus } from "../shared/rpc-schema";
import { ConfirmButton } from "./ConfirmButton";
import { useT } from "./i18n";
import { guardPackageInstallKey } from "./manual-package-install";

export function ManualPackageInstall({
  source,
  onSourceChange,
  onInstall,
  operation,
  error,
}: {
  source: string;
  onSourceChange: (source: string) => void;
  onInstall: () => void;
  operation?: PackageOpStatus;
  error?: string;
}) {
  const t = useT();
  const id = useId();
  const composing = useRef(false);
  const busy = operation?.status === "running";
  const failure =
    error ?? (operation?.status === "error" ? operation.message : undefined);
  const description = `${id}-help ${id}-trust ${id}-status${failure ? ` ${id}-error` : ""}`;
  return (
    <div className="package-manual-install" aria-busy={busy}>
      <label htmlFor={`${id}-source`}>{t.manualPackageSource}</label>
      <div className="package-manual-source-row">
        <input
          id={`${id}-source`}
          type="text"
          value={source}
          placeholder={t.manualPackagePlaceholder}
          autoComplete="off"
          spellCheck={false}
          disabled={busy}
          aria-describedby={description}
          aria-invalid={failure ? true : undefined}
          onChange={(event) => onSourceChange(event.target.value)}
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={() => {
            composing.current = false;
          }}
        />
        <ConfirmButton
          key={source}
          className="primary"
          disabled={!source.trim() || busy}
          title={
            t[
              "Packages can run code on your machine. Only install packages you trust."
            ]
          }
          aria-describedby={`${id}-trust`}
          onKeyDown={guardPackageInstallKey}
          onConfirm={() => {
            if (!composing.current) onInstall();
          }}
        >
          <Download size={14} aria-hidden="true" />
          {failure ? t.Retry : t.Install}
        </ConfirmButton>
      </div>
      <p id={`${id}-help`} className="muted">
        {t.manualPackageHelp}
      </p>
      <p id={`${id}-trust`} className="muted">
        {
          t[
            "Packages can run code on your machine. Only install packages you trust."
          ]
        }
      </p>
      <p
        id={`${id}-status`}
        className="status"
        role="status"
        aria-atomic="true"
      >
        {busy ? (
          <>
            <LoaderCircle size={14} className="spinner" aria-hidden="true" />
            {operation.action === "install"
              ? t["Installing…"]
              : operation.action === "uninstall"
                ? t["Removing…"]
                : t["Updating…"]}
          </>
        ) : operation?.status === "done" && operation.action === "install" ? (
          t.manualPackageInstalled
        ) : (
          ""
        )}
      </p>
      {failure && (
        <p id={`${id}-error`} className="package-op-error error" role="alert">
          {failure}
        </p>
      )}
    </div>
  );
}
