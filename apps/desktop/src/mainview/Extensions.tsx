import {
  ArrowLeft,
  ArrowUpCircle,
  Check,
  CircleAlert,
  Copy,
  Download,
  ExternalLink,
  LoaderCircle,
  Package,
  Puzzle,
  Search,
  ShieldAlert,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { npmName } from "../shared/packages";
import type {
  InstalledPackage,
  MarketPackage,
  PackageOpStatus,
  PackageType,
} from "../shared/rpc-schema";
import { getT, useT } from "./i18n";
import { navigate } from "./navigation";
import { rpc } from "./rpc";
import { receivePackageOp, showError, useStore } from "./store";
import "./extensions.css";

function CopyCommand({ name }: { name: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  async function copy() {
    try {
      if (!navigator.clipboard?.writeText)
        throw new Error(t["Clipboard is unavailable."]);
      await navigator.clipboard.writeText(`pi install npm:${name}`);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1500);
    } catch (error) {
      showError(t.copyError(String(error)));
    }
  }
  return (
    <button
      type="button"
      className="package-command"
      title={t.copyInstall(name)}
      aria-label={t.copyCommand(name)}
      onClick={() => void copy()}
    >
      <span className="package-command-text">$ pi install npm:{name}</span>
      <span
        className={`package-copy-feedback ${copied ? "is-copied" : ""}`}
        aria-live="polite"
      >
        {copied ? (
          <>
            <Check size={13} aria-hidden="true" />

            {t.Copied}
          </>
        ) : (
          <Copy size={13} aria-hidden="true" />
        )}
      </span>
    </button>
  );
}

// Package discovery should fail promptly even if an older main process lacks handlers.
function request<T>(promise: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(
          new Error(getT()["Package service did not respond. Please retry."]),
        ),
      20000,
    );
    promise.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}
function downloads(n: number) {
  return getT().downloads(
    String(
      n >= 1e6
        ? `${+(n / 1e6).toFixed(1)}M`
        : n >= 1000
          ? `${+(n / 1000).toFixed(1)}k`
          : n,
    ),
  );
}
function relative(date: string) {
  const t = getT();
  const days = Math.max(
    0,
    Math.floor((Date.now() - Date.parse(date)) / 86400000),
  );
  if (!Number.isFinite(days)) return t["Date unavailable"];
  return days < 1
    ? t.today
    : days < 30
      ? t.relativeDate(days, "d")
      : days < 365
        ? t.relativeDate(Math.floor(days / 30), "mo")
        : t.relativeDate(Math.floor(days / 365), "y");
}
function Badges({ types }: { types: PackageType[] }) {
  return (
    <span className="package-badges">
      {(types.length ? types : ["package"]).map((type) => (
        <span key={type} className={`package-badge package-${type}`}>
          {type}
        </span>
      ))}
    </span>
  );
}
function Link({ url, children }: { url: string; children: React.ReactNode }) {
  return (
    <a
      href={url}
      onClick={(e) => {
        e.preventDefault();
        rpc.send.openExternal({ url });
      }}
    >
      {children}
      <ExternalLink size={10} aria-hidden="true" />
    </a>
  );
}
function Preview({ url }: { url?: string | null }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="package-preview">
      {url && !failed ? (
        <img
          src={url}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
        />
      ) : (
        <Package size={28} strokeWidth={1.25} aria-hidden="true" />
      )}
    </div>
  );
}
type Confirmation = {
  action: "install" | "uninstall";
  source: string;
  name: string;
};
function Confirm({
  value,
  close,
  confirm,
}: {
  value: Confirmation;
  close: () => void;
  confirm: () => void;
}) {
  const t = useT();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return () => {
      previous?.focus();
    };
  }, []);
  const install = value.action === "install";
  return (
    <dialog
      ref={dialog}
      className="package-dialog"
      aria-labelledby="package-confirm-title"
      aria-describedby="package-confirm-description"
      onCancel={close}
    >
      <ShieldAlert
        size={24}
        className={install ? "package-warning" : "muted"}
      />
      <h2 id="package-confirm-title">
        {install ? t.Install : t.Uninstall} {value.name}?
      </h2>
      <p id="package-confirm-description" className="muted">
        {install
          ? t[
              "Packages can run code on your machine. Only install packages you trust."
            ]
          : t[
              "This package will be removed from your pi configuration. Open chats will be reloaded."
            ]}
      </p>
      <div className="package-dialog-actions">
        <button type="button" onClick={close}>
          {t.Cancel}
        </button>
        <button type="button" className="primary" onClick={confirm}>
          {install ? t.Install : t.Uninstall}
        </button>
      </div>
    </dialog>
  );
}
function operation(source: string, ops: Record<string, PackageOpStatus>) {
  const matches = Object.values(ops).filter(
    (op) =>
      op.source === source ||
      (npmName(source) && npmName(op.source) === npmName(source)),
  );
  return matches.find((op) => op.status === "running") ?? matches.at(-1);
}
function Progress({ op }: { op?: PackageOpStatus }) {
  const t = useT();
  if (op?.status === "running")
    return (
      <span className="status" role="status">
        <LoaderCircle size={14} className="spinner" />
        {op.action === "install"
          ? t["Installing…"]
          : op.action === "uninstall"
            ? t["Removing…"]
            : t["Updating…"]}
      </span>
    );
  return null;
}
function OpError({ op }: { op?: PackageOpStatus }) {
  return op?.status === "error" ? (
    <p className="package-op-error error" role="alert">
      <CircleAlert size={14} />
      {op.message}
    </p>
  ) : null;
}
export function Extensions() {
  const t = useT();
  const installed = useStore((s) => s.installed);
  const ops = useStore((s) => s.packageOps);
  const [tab, setTab] = useState<"marketplace" | "installed">("marketplace");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [retry, setRetry] = useState(0);
  const [items, setItems] = useState<MarketPackage[]>([]);
  const [previews, setPreviews] = useState<Record<string, string | null>>({});
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [installedLoading, setInstalledLoading] = useState(true);
  const [installedError, setInstalledError] = useState<string>();
  const [installedRetry, setInstalledRetry] = useState(0);
  const [confirmation, setConfirmation] = useState<Confirmation>();
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(query.trim());
      setPage(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Retry explicitly refreshes the request.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    if (page === 0) setItems([]);
    void request(rpc.request.searchPackages({ query: search, page }))
      .then(async (result) => {
        if (cancelled) return;
        setItems((previous) =>
          page === 0
            ? result.items
            : [
                ...previous,
                ...result.items.filter(
                  (item) => !previous.some((p) => p.name === item.name),
                ),
              ],
        );
        setTotal(result.total);
        setLoading(false);
        for (let i = 0; i < result.items.length; i += 64) {
          try {
            const images = await request(
              rpc.request.packagePreviews({
                names: result.items.slice(i, i + 64).map((p) => p.name),
              }),
            );
            if (!cancelled)
              setPreviews((previous) => ({ ...previous, ...images }));
          } catch {
            /* Preview failure leaves a neutral placeholder. */
          }
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(String(e));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [search, page, retry]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Retry explicitly refreshes the request.
  useEffect(() => {
    let cancelled = false;
    const previous = useStore.getState().installed;
    setInstalledLoading(true);
    setInstalledError(undefined);
    void request(rpc.request.listInstalled())
      .then((next) => {
        if (!cancelled && useStore.getState().installed === previous)
          useStore.setState({ installed: next });
      })
      .catch((e: unknown) => {
        if (!cancelled) setInstalledError(String(e));
      })
      .finally(() => {
        if (!cancelled) setInstalledLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [installedRetry]);
  function run(action: PackageOpStatus["action"], source: string) {
    if (operation(source, useStore.getState().packageOps)?.status === "running")
      return;
    const opId = crypto.randomUUID();
    receivePackageOp({ opId, source, action, status: "running" });
    try {
      if (action === "install")
        rpc.send.installPackage({ opId, name: npmName(source) ?? source });
      else if (action === "uninstall")
        rpc.send.uninstallPackage({ opId, source });
      else rpc.send.updatePackage({ opId, source });
    } catch (e) {
      receivePackageOp({
        opId,
        source,
        action,
        status: "error",
        message: String(e),
      });
    }
  }
  function selectTab(next: typeof tab, focus = false) {
    setTab(next);
    if (focus) document.getElementById(`extensions-tab-${next}`)?.focus();
  }
  return (
    <div className="extensions-page">
      <button
        className="back-button"
        type="button"
        onClick={() => navigate("chat")}
      >
        <ArrowLeft size={14} />

        {t["Back to chat"]}
      </button>
      <h1>{t.Extensions}</h1>
      <p className="muted page-description">
        {t["Make pi your own with community packages."]}
      </p>
      <div
        className="extensions-tabs"
        role="tablist"
        aria-label={t.Extensions}
        onKeyDown={(e) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key))
            return;
          e.preventDefault();
          selectTab(
            e.key === "Home"
              ? "marketplace"
              : e.key === "End"
                ? "installed"
                : tab === "installed"
                  ? "marketplace"
                  : "installed",
            true,
          );
        }}
      >
        {(["marketplace", "installed"] as const).map((name) => (
          <button
            key={name}
            type="button"
            id={`extensions-tab-${name}`}
            role="tab"
            aria-selected={tab === name}
            aria-controls={`extensions-panel-${name}`}
            tabIndex={tab === name ? 0 : -1}
            onClick={() => selectTab(name)}
          >
            {name === "marketplace" ? (
              <Puzzle size={15} />
            ) : (
              <Download size={15} />
            )}
            {name === "marketplace" ? t.Marketplace : t.Installed}
            {name === "installed" && (
              <span className="package-count">{installed.length}</span>
            )}
          </button>
        ))}
      </div>
      <section
        role="tabpanel"
        id={`extensions-panel-${tab}`}
        aria-labelledby={`extensions-tab-${tab}`}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: ARIA tab panels must be reachable by keyboard.
        tabIndex={0}
      >
        {tab === "marketplace" ? (
          <>
            <div className="package-search">
              <Search size={17} aria-hidden="true" />
              <input
                aria-label={t["Search packages"]}
                placeholder={t["Search packages…"]}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {query && (
                <button
                  type="button"
                  aria-label={t["Clear search"]}
                  onClick={() => setQuery("")}
                >
                  <X size={14} />
                </button>
              )}
            </div>
            <p className="package-results muted" role="status">
              {loading && !items.length
                ? t["Finding packages…"]
                : error && !items.length
                  ? t["Marketplace unavailable"]
                  : t.packageResults(total, search)}
            </p>
            <div className="package-list market-grid" aria-busy={loading}>
              {items.map((pkg) => {
                const match = installed.find(
                  (p) => npmName(p.source) === pkg.name,
                );
                const source = match?.source ?? `npm:${pkg.name}`;
                const op = operation(source, ops);
                const report = new URL(
                  "https://github.com/earendil-works/pi/issues/new",
                );
                report.search = new URLSearchParams({
                  template: "package-report.yml",
                  labels: "package-report",
                  title: `Package Report: ${pkg.name}`,
                  "package-name": pkg.name,
                  "package-version": pkg.version,
                }).toString();
                return (
                  <article className="market-card" key={pkg.name}>
                    <div className="package-card-heading">
                      <Preview
                        key={previews[pkg.name] ?? pkg.name}
                        url={previews[pkg.name]}
                      />
                      <div className="package-content">
                        <h2>{pkg.name}</h2>
                        <p className="package-meta">
                          {pkg.publisher || t["Unknown publisher"]} ·{" "}
                          {downloads(pkg.monthlyDownloads)} ·{" "}
                          {relative(pkg.date)}
                        </p>
                      </div>
                    </div>
                    <p
                      className="package-description"
                      title={pkg.description || t["No description provided."]}
                    >
                      {pkg.description || t["No description provided."]}
                    </p>
                    <div className="package-details">
                      <Badges types={pkg.types} />
                      <div className="package-links">
                        {pkg.npmUrl && <Link url={pkg.npmUrl}>npm</Link>}
                        {pkg.repoUrl && <Link url={pkg.repoUrl}>{t.repo}</Link>}
                        <Link url={report.toString()}>{t.report}</Link>
                      </div>
                    </div>
                    <div className="package-card-footer">
                      <CopyCommand name={pkg.name} />
                      <div className="package-actions">
                        {op?.status === "running" ? (
                          <Progress op={op} />
                        ) : match ? (
                          <>
                            <span className="status connected">
                              <Check size={14} />

                              {t.Installed}
                            </span>
                            <button
                              type="button"
                              className="quiet"
                              onClick={() =>
                                setConfirmation({
                                  action: "uninstall",
                                  source,
                                  name: pkg.name,
                                })
                              }
                            >
                              <Trash2 size={13} />

                              {t.Uninstall}
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            className="primary"
                            disabled={installedLoading || !!installedError}
                            title={
                              installedError
                                ? t["Installed packages could not be checked"]
                                : undefined
                            }
                            onClick={() =>
                              setConfirmation({
                                action: "install",
                                source,
                                name: pkg.name,
                              })
                            }
                          >
                            <Download size={14} />

                            {t.Install}
                          </button>
                        )}
                      </div>
                    </div>
                    <OpError op={op} />
                  </article>
                );
              })}
              {loading &&
                !items.length &&
                [0, 1, 2].map((n) => (
                  <div className="package-skeleton" key={n} aria-hidden="true">
                    <div />
                    <div>
                      <span />
                      <span />
                      <span />
                    </div>
                  </div>
                ))}
            </div>
            {error && (
              <ErrorState
                message={error}
                retry={() => setRetry((n) => n + 1)}
              />
            )}
            {!loading && !error && !items.length && (
              <div className="package-empty">
                <Search size={28} />
                <h2>{t["No packages found"]}</h2>
                <p className="muted">{t["Try a different name or keyword."]}</p>
                <button type="button" onClick={() => setQuery("")}>
                  {t["Clear search"]}
                </button>
              </div>
            )}
            {items.length > 0 && items.length < total && !error && (
              <div className="package-load-more">
                <button
                  type="button"
                  className="secondary"
                  disabled={loading}
                  onClick={() => setPage((n) => n + 1)}
                >
                  {loading ? (
                    <LoaderCircle size={14} className="spinner" />
                  ) : null}
                  {loading ? t["Loading…"] : t["Load more"]}
                </button>
                <span className="muted">{t.countOf(items.length, total)}</span>
              </div>
            )}
            {installedError && (
              <ErrorState
                message={t.installedError(installedError)}
                retry={() => setInstalledRetry((n) => n + 1)}
              />
            )}
          </>
        ) : (
          <>
            <p className="package-results muted">
              {t["Packages from your user and project configuration."]}
            </p>
            {installedLoading && (
              <p className="status" role="status">
                <LoaderCircle size={14} className="spinner" />

                {t["Loading installed packages…"]}
              </p>
            )}
            {installedError && (
              <ErrorState
                message={installedError}
                retry={() => setInstalledRetry((n) => n + 1)}
              />
            )}
            {!installedLoading && !installedError && !installed.length && (
              <div className="package-empty">
                <Package size={32} />
                <h2>{t["No extensions installed"]}</h2>
                <p className="muted">
                  {t["Find a package to extend your workflow."]}
                </p>
                <button
                  type="button"
                  className="primary"
                  onClick={() => selectTab("marketplace", true)}
                >
                  {t["Browse Marketplace"]}
                </button>
              </div>
            )}
            <div className="package-list">
              {installed.map((pkg: InstalledPackage) => {
                const name = npmName(pkg.source)
                  ? (pkg.name ?? npmName(pkg.source) ?? pkg.source)
                  : pkg.source;
                const op = operation(pkg.source, ops);
                return (
                  <article
                    className="installed-card"
                    key={`${pkg.scope}:${pkg.source}`}
                  >
                    <div className="package-content">
                      <div className="installed-heading">
                        <h2>{name}</h2>
                        <span className="package-scope">{pkg.scope}</span>
                      </div>
                      {pkg.version && (
                        <span className="package-meta">v{pkg.version}</span>
                      )}
                      {pkg.description && (
                        <p className="package-description">{pkg.description}</p>
                      )}
                      <Badges types={pkg.types} />
                      {pkg.updateAvailable && (
                        <span className="package-update">
                          <ArrowUpCircle size={13} />

                          {t["Update available"]}
                        </span>
                      )}
                      <OpError op={op} />
                    </div>
                    <div className="package-actions">
                      {op?.status === "running" ? (
                        <Progress op={op} />
                      ) : (
                        <>
                          {pkg.updateAvailable && (
                            <button
                              type="button"
                              className="primary"
                              onClick={() => run("update", pkg.source)}
                            >
                              <ArrowUpCircle size={14} />

                              {t.Update}
                            </button>
                          )}
                          <button
                            type="button"
                            className="quiet"
                            onClick={() =>
                              setConfirmation({
                                action: "uninstall",
                                source: pkg.source,
                                name,
                              })
                            }
                          >
                            <Trash2 size={13} />

                            {t.Uninstall}
                          </button>
                        </>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          </>
        )}
      </section>
      {confirmation && (
        <Confirm
          value={confirmation}
          close={() => setConfirmation(undefined)}
          confirm={() => {
            run(confirmation.action, confirmation.source);
            setConfirmation(undefined);
          }}
        />
      )}
    </div>
  );
}
function ErrorState({
  message,
  retry,
}: {
  message: string;
  retry: () => void;
}) {
  const t = useT();
  return (
    <div className="package-error" role="alert">
      <CircleAlert size={18} />
      <div>
        <h2>{t["Couldn’t load packages"]}</h2>
        <p>{message}</p>
      </div>
      <button type="button" className="secondary" onClick={retry}>
        {t.Retry}
      </button>
    </div>
  );
}
