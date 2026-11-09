import { Download, Package, Search, ShieldAlert, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  type InstalledPackage,
  type MarketPackage,
  npmName,
  type PackageCompatibility,
  type PackageOperation,
  type PackageSearchResult,
  type PackageService,
} from "../shared/packages";
import {
  compatibilityLabel,
  emptyPackageState,
  receivePackageEvent,
} from "./package-state";
import "./extensions.css";

export type ExtensionsProps = {
  /** Root integration supplies an RPC-backed service; absent handlers never imply success. */
  service?: PackageService;
};
const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

function Compatibility({ value }: { value: PackageCompatibility }) {
  // A tested badge without evidence must not claim verified compatibility.
  const status = value.evidence
    ? value.status
    : value.status === "limited"
      ? "limited"
      : "unverified";
  return (
    <span className="package-badge" title={value.limitations ?? value.evidence}>
      {compatibilityLabel(status)}
    </span>
  );
}
function ConfirmPackage({
  operation,
  profile,
  close,
  confirm,
}: {
  operation: PackageOperation;
  profile: string;
  close: () => void;
  confirm: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    cancelButton.current?.focus();
    return () => {
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="package-confirm"
      aria-labelledby="package-confirm-title"
      onCancel={close}
    >
      <h2 id="package-confirm-title">Confirm {operation.action}</h2>
      <p>
        {operation.action === "install" ? operation.name : operation.source}
      </p>
      <p>
        Pi packages execute arbitrary code with this app’s permissions. npm
        listing is not a safety review. UI compatibility may be unverified.
      </p>
      <p>
        User scope only: <code>{profile}</code>. Running or input-waiting
        sessions must wait for safe application.
      </p>
      <div className="package-card-footer">
        <button ref={cancelButton} type="button" onClick={close}>
          Cancel
        </button>
        <button type="button" onClick={confirm}>
          Confirm {operation.action}
        </button>
      </div>
    </dialog>
  );
}

/** Keep this component mounted with a stable service; key by agentDir when changing profile. */
export function Extensions({ service }: ExtensionsProps = {}) {
  const [tab, setTab] = useState<"market" | "installed">("market");
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<PackageSearchResult>();
  const [page, setPage] = useState(0);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [error, setError] = useState("");
  const [state, setState] = useState(emptyPackageState);
  const [confirmation, setConfirmation] = useState<PackageOperation>();
  const [busy, setBusy] = useState(false);
  const current = useRef(service);
  current.current = service;
  const searchGeneration = useRef(0);
  const installedGeneration = useRef(0);
  const loading = useRef(false);

  useEffect(() => {
    setState(emptyPackageState());
    setResult(undefined);
    setPage(0);
    setError("");
    setSearchError("");
    setConfirmation(undefined);
    setBusy(false);
    setSearching(false);
    searchGeneration.current++;
    installedGeneration.current++;
    if (!service) return;
    const revision = ++installedGeneration.current;
    const unsubscribe = service.subscribe((event) => {
      if (current.current !== service) return;
      if (event.type === "installed" && event.agentDir === service.agentDir)
        installedGeneration.current++;
      setState((old) => receivePackageEvent(old, service.agentDir, event));
    });
    void service
      .listInstalled()
      .then((installed) => {
        if (
          current.current === service &&
          revision === installedGeneration.current
        )
          setState((old) => ({ ...old, installed }));
      })
      .catch((failure) => {
        if (current.current === service) setError(message(failure));
      });
    return () => {
      unsubscribe();
      searchGeneration.current++;
      installedGeneration.current++;
    };
  }, [service]);

  async function search(nextPage: number) {
    if (!service) return;
    const generation = ++searchGeneration.current;
    setSearching(true);
    setSearchError("");
    try {
      const found = await service.search({ query, page: nextPage });
      if (
        current.current !== service ||
        generation !== searchGeneration.current
      )
        return;
      setResult(found);
      setPage(nextPage);
    } catch (failure) {
      if (
        current.current === service &&
        generation === searchGeneration.current
      )
        setSearchError(message(failure));
      // Retain the last successful result; never replace it with an empty failure state.
    } finally {
      if (
        current.current === service &&
        generation === searchGeneration.current
      )
        setSearching(false);
    }
  }
  async function refresh() {
    if (!service) return;
    const revision = ++installedGeneration.current;
    setError("");
    try {
      const installed = await service.listInstalled();
      if (
        current.current === service &&
        revision === installedGeneration.current
      )
        setState((old) => ({ ...old, installed }));
    } catch (failure) {
      if (current.current === service) setError(message(failure));
    }
  }
  async function operate(operation: PackageOperation) {
    if (!service || loading.current) return;
    loading.current = true;
    setBusy(true);
    setConfirmation(undefined);
    setError("");
    try {
      const response = await service.operate(operation);
      if (current.current !== service) return;
      setState((old) => {
        const saved = receivePackageEvent(old, service.agentDir, {
          type: "operation",
          operation: response.operation,
        });
        return saved.applications.some(
          (app) => app.change.opId === response.operation.opId,
        )
          ? saved
          : receivePackageEvent(saved, service.agentDir, {
              type: "apply",
              change: response.operation,
              report: response.apply,
            });
      });
    } catch (failure) {
      if (current.current === service) setError(message(failure));
    } finally {
      loading.current = false;
      if (current.current === service) setBusy(false);
    }
  }
  const isInstalled = (name: string) =>
    state.installed.some((pkg) => npmName(pkg.source) === name);
  function ask(
    action: PackageOperation["action"],
    pkg: MarketPackage | InstalledPackage,
  ) {
    const opId = crypto.randomUUID();
    setConfirmation(
      action === "install"
        ? { opId, action, name: pkg.name }
        : { opId, action, source: (pkg as InstalledPackage).source },
    );
  }
  return (
    <section className="extensions-page">
      <h1>Pi Marketplace</h1>
      <p className="package-description">
        Discover ordinary Pi packages on npm. Manage packages for this app’s SDK
        user profile only, not project packages or the Pi CLI profile.
      </p>
      <p className="package-warning">
        <ShieldAlert size={16} aria-hidden="true" /> Packages can execute
        arbitrary code with your user permissions. npm availability does not
        mean safe or GUI compatible.
      </p>
      <p className="package-scope">
        SDK profile: <code>{service?.agentDir ?? "not connected"}</code> · User
        scope
      </p>
      {!service && (
        <p role="status">
          Marketplace service is not connected. Search and package changes are
          unavailable until SDK integration is enabled.
        </p>
      )}
      <nav className="extensions-tabs" aria-label="Package views">
        <button
          type="button"
          aria-pressed={tab === "market"}
          onClick={() => setTab("market")}
        >
          Marketplace
        </button>
        <button
          type="button"
          aria-pressed={tab === "installed"}
          onClick={() => setTab("installed")}
        >
          Installed ({state.installed.length})
        </button>
      </nav>
      {error && (
        <p className="package-error" role="alert">
          {error}
        </p>
      )}
      {tab === "market" ? (
        <>
          <form
            className="package-search"
            onSubmit={(event) => {
              event.preventDefault();
              void search(0);
            }}
          >
            <Search size={16} aria-hidden="true" />
            <input
              aria-label="Search Pi packages"
              placeholder="Search Pi packages"
              maxLength={200}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              disabled={!service}
            />
            <button type="submit" disabled={!service || searching}>
              {searching ? "Searching…" : "Search"}
            </button>
          </form>
          {searchError && (
            <p role="alert" className="package-error">
              {searchError} Previous results are retained.
            </p>
          )}
          <p className="package-results" role="status">
            {result
              ? `${result.total} packages · Page ${page + 1}`
              : "Search npm’s pi-package catalog to get started."}
          </p>
          <div className="package-list market-grid" aria-busy={searching}>
            {result?.items.map((pkg) => (
              <article className="market-card" key={pkg.name}>
                <div className="package-card-heading">
                  <Package size={24} aria-hidden="true" />
                  <h2>{pkg.name}</h2>
                </div>
                <p className="package-meta">
                  {pkg.version} · {pkg.monthlyDownloads.toLocaleString()}{" "}
                  monthly downloads
                </p>
                <p className="package-description">{pkg.description}</p>
                <div className="package-badges">
                  <Compatibility value={pkg.compatibility} />
                  {pkg.types.map((type) => (
                    <span key={type} className="package-badge">
                      {type}
                    </span>
                  ))}
                </div>
                <div className="package-card-footer">
                  <button
                    type="button"
                    disabled={!service || busy || isInstalled(pkg.name)}
                    onClick={() => ask("install", pkg)}
                  >
                    <Download size={14} aria-hidden="true" />
                    {isInstalled(pkg.name) ? "Installed" : "Install"}
                  </button>
                </div>
              </article>
            ))}
          </div>
          {result && (
            <div className="package-pagination">
              <button
                type="button"
                disabled={searching || page === 0}
                onClick={() => void search(page - 1)}
              >
                Previous
              </button>
              <button
                type="button"
                disabled={
                  searching ||
                  page >= 199 ||
                  (page + 1) * result.pageSize >= result.total
                }
                onClick={() => void search(page + 1)}
              >
                Next
              </button>
            </div>
          )}
        </>
      ) : (
        <>
          <button
            type="button"
            disabled={!service || busy}
            onClick={() => void refresh()}
          >
            Refresh Installed
          </button>
          {!state.installed.length && (
            <p>
              No user packages loaded. Refresh errors do not remove existing
              entries.
            </p>
          )}
          <div className="package-list">
            {state.installed.map((pkg) => (
              <article key={pkg.source} className="installed-card">
                <h2>{pkg.name}</h2>
                <p className="package-meta">
                  {pkg.version ?? "Version unavailable"} · User scope ·{" "}
                  {pkg.source}
                </p>
                <p className="package-description">{pkg.description}</p>
                <Compatibility value={pkg.compatibility} />
                <div className="package-card-footer">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => ask("update", pkg)}
                  >
                    Update
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => ask("uninstall", pkg)}
                  >
                    <Trash2 size={14} aria-hidden="true" />
                    Remove
                  </button>
                </div>
              </article>
            ))}
          </div>
        </>
      )}
      <div className="package-status" aria-live="polite">
        {state.operations.map((op) => (
          <p key={op.opId}>
            Package {op.action} · {op.source}:{" "}
            <strong>{op.status === "done" ? "saved" : op.status}</strong>
            {op.message && ` — ${op.message}`}
          </p>
        ))}
        {state.applications.map(({ change, report }) => (
          <div key={change.opId}>
            <p>
              Session application · {change.source}:{" "}
              <strong>{report.status}</strong>
              {report.message && ` — ${report.message}`}
            </p>
            {!!report.pendingSessionIds?.length && (
              <p>Waiting sessions: {report.pendingSessionIds.join(", ")}</p>
            )}
            {[...new Set(report.diagnostics)].map((diagnostic) => (
              <pre key={diagnostic}>{diagnostic}</pre>
            ))}
          </div>
        ))}
        {[...new Set(state.diagnostics)].map((diagnostic) => (
          <pre key={diagnostic}>{diagnostic}</pre>
        ))}
      </div>
      {confirmation && service && (
        <ConfirmPackage
          operation={confirmation}
          profile={service.agentDir}
          close={() => setConfirmation(undefined)}
          confirm={() => void operate(confirmation)}
        />
      )}
    </section>
  );
}
