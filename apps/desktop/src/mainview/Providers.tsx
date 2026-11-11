import { LoaderCircle, LogIn, LogOut, Search, X } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import type { AuthMethod, ProviderInfo } from "../shared/rpc-schema";
import { ConfirmButton } from "./ConfirmButton";
import { ContentPage } from "./ContentPage";
import { useT } from "./i18n";
import { ProviderIcon } from "./ProviderIcon";
import { ProviderModels } from "./ProviderModels";
import { refresh, rpc } from "./rpc";
import { showError, useStore } from "./store";
import {
  ClassificationSettings,
  ImageModelSettings,
} from "./UtilityModelSettings";
import { publishProvider } from "./ui-mutations";

const filters = ["all", "connected", "oauth", "api_key", "extension"] as const;
type Filter = (typeof filters)[number];
const matchesFilter = (p: ProviderInfo, filter: Filter) =>
  filter === "all" ||
  (filter === "connected"
    ? p.configured
    : filter === "oauth"
      ? !!p.oauth
      : filter === "api_key"
        ? p.apiKey
        : p.extension);

function startLogin(provider: string, method: AuthMethod) {
  const previous = useStore.getState().login;
  if (previous) rpc.send.cancelLogin({ loginId: previous.loginId });
  const loginId = crypto.randomUUID();
  useStore.setState({ login: { loginId, provider, method } });
  rpc.send.startLogin({ provider, method, loginId });
}

export function Providers() {
  const t = useT();
  const providers = useStore((s) => s.bootstrap.providers);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<string>();
  const [category, setCategory] = useState("chat");
  const q = query.trim().toLowerCase();
  const matches = providers.filter(
    (p) =>
      matchesFilter(p, filter) &&
      (!q || `${p.name} ${p.id}`.toLowerCase().includes(q)),
  );
  const groups = [
    { label: t.Connected, items: matches.filter((p) => p.configured) },
    { label: t.Providers, items: matches.filter((p) => !p.configured) },
  ].filter((group) => group.items.length);
  const current =
    providers.find((p) => p.id === selected) ?? groups[0]?.items[0];
  const filterLabels: Record<Filter, string> = {
    all: t.All,
    connected: t.Connected,
    oauth: t["Sign in"],
    api_key: t["API key"],
    extension: t.Extension,
  };
  return (
    <ContentPage
      className="providers-page"
      title={t.Providers}
      description={
        t[
          "Connect a subscription or API key. Providers can also use credentials from the environment."
        ]
      }
    >
      <nav
        className="segmented-control provider-categories"
        aria-label={t.Providers}
      >
        {[
          ["chat", "Agent"],
          ["images", "Image"],
          ["classification", "Classification"],
        ].map(([id, label]) => (
          <button
            key={id}
            id={`provider-category-${id}`}
            type="button"
            aria-pressed={category === id}
            onClick={() => setCategory(id)}
          >
            {label}
          </button>
        ))}
      </nav>
      {category === "images" ? (
        <div className="provider-utility-panel">
          <ImageModelSettings onConnect={() => setCategory("chat")} />
        </div>
      ) : category === "classification" ? (
        <div className="provider-utility-panel">
          <ClassificationSettings />
        </div>
      ) : !providers.length ? (
        <p className="model-list-empty">{t["No matching providers"]}</p>
      ) : (
        <div className="providers-layout">
          <div className="provider-browser">
            <div className="provider-search">
              <Search size={14} />
              <input
                aria-label={t["Search providers"]}
                placeholder={t["Search providers"]}
                spellCheck={false}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              {query && (
                <button
                  type="button"
                  aria-label={t["Clear provider search"]}
                  onClick={() => setQuery("")}
                >
                  <X size={12} />
                </button>
              )}
            </div>
            <fieldset
              className="provider-filters"
              aria-label={t["Provider filters"]}
            >
              {filters.map((id) => {
                const count = providers.filter((p) =>
                  matchesFilter(p, id),
                ).length;
                if (id === "extension" && !count) return null;
                return (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={filter === id}
                    onClick={() => setFilter(id)}
                  >
                    {filterLabels[id]}
                    {id !== "all" && <small>{count}</small>}
                  </button>
                );
              })}
            </fieldset>
            <div className="provider-groups">
              {groups.map((group) => (
                <section key={group.label} aria-label={group.label}>
                  <h2 className="provider-group-title">{group.label}</h2>
                  {group.items.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className="provider-row"
                      aria-current={p.id === current?.id || undefined}
                      onClick={() => setSelected(p.id)}
                    >
                      <ProviderIcon provider={p.id} size={16} />
                      <span className="provider-row-name">{p.name}</span>
                      {p.extension ? (
                        <small className="provider-tag" data-kind="extension">
                          {t.Extension}
                        </small>
                      ) : (
                        p.oauth?.subscription && (
                          <small className="provider-tag">
                            {t.Subscription}
                          </small>
                        )
                      )}
                      {p.configured && (
                        <span
                          className="provider-dot"
                          role="img"
                          aria-label={t.Connected}
                        />
                      )}
                    </button>
                  ))}
                </section>
              ))}
              {!groups.length && (
                <p className="model-list-empty">{t["No matching providers"]}</p>
              )}
            </div>
          </div>
          {current && <ProviderDetail key={current.id} provider={current} />}
        </div>
      )}
    </ContentPage>
  );
}

export function ProviderDetail({
  provider: p,
  children,
}: {
  provider: ProviderInfo;
  children?: ReactNode;
}) {
  const titleId = useId();
  const t = useT();
  const login = useStore((s) => s.login);
  const [loggingOut, setLoggingOut] = useState(false);
  const mine = login?.provider === p.id;
  const error = mine ? login?.error : undefined;
  const busy = mine && !error;
  const state = error
    ? "error"
    : busy
      ? "busy"
      : p.configured
        ? "online"
        : "offline";
  // "stored"/"runtime" are pi-internal; other sources are env vars or file labels.
  const via =
    p.configured && p.source && p.source !== "stored" && p.source !== "runtime"
      ? p.source
      : undefined;
  const status =
    error ||
    (busy
      ? t["Signing in"]
      : p.configured
        ? via
          ? `${t.Connected} · ${via}`
          : t.Connected
        : t["Not connected"]);
  return (
    <section className="provider-detail" aria-labelledby={titleId}>
      <header className="provider-detail-header">
        <ProviderIcon provider={p.id} size={28} />
        <div>
          <h2 id={titleId}>{p.name}</h2>
          <code>{p.id}</code>
        </div>
        <span
          className="provider-status"
          data-state={state}
          role="status"
          title={via && t.connectedVia(via)}
        >
          {busy && <LoaderCircle size={11} className="spinner" />}
          <span>{status}</span>
        </span>
        <div className="inline-actions">
          {p.stored ? (
            <ConfirmButton
              disabled={loggingOut}
              onConfirm={() => {
                const current = useStore.getState().login;
                if (current?.provider === p.id) {
                  rpc.send.cancelLogin({ loginId: current.loginId });
                  useStore.setState({ login: undefined });
                }
                setLoggingOut(true);
                // Show signed out now; an env or file credential may still
                // connect it, which the refresh reports.
                const ambient =
                  !!p.source && p.source !== "stored" && p.source !== "runtime";
                publishProvider(p.id, {
                  stored: false,
                  configured: ambient && p.configured,
                });
                void rpc.request
                  .logout({ provider: p.id })
                  .catch(showError)
                  .then(refresh)
                  .catch(showError)
                  .finally(() => setLoggingOut(false));
              }}
            >
              <LogOut size={14} /> {t["Sign out"]}
            </ConfirmButton>
          ) : (
            <>
              {p.oauth && (
                <button
                  type="button"
                  className="primary"
                  onClick={() => startLogin(p.id, "oauth")}
                >
                  <LogIn size={14} /> {p.oauth.label ?? t["Sign in"]}
                </button>
              )}
              {p.apiKey && (
                <button
                  type="button"
                  className={p.oauth ? undefined : "primary"}
                  onClick={() => startLogin(p.id, "api_key")}
                >
                  {t["API key"]}
                </button>
              )}
            </>
          )}
        </div>
      </header>
      {!p.configured && !p.oauth && !p.apiKey && (
        <p className="provider-hint muted">
          {t["This provider uses environment variables or cloud credentials."]}
        </p>
      )}
      {children ?? <ProviderModels provider={p.id} connected={p.configured} />}
    </section>
  );
}
