import { LoaderCircle, LogIn, LogOut, Search, X } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import {
  type AccountSource,
  providerAccountSources,
} from "../shared/account-models";
import type { ProviderInfo } from "../shared/rpc-schema";
import { ConfirmButton } from "./ConfirmButton";
import { ContentPage } from "./ContentPage";
import { useT } from "./i18n";
import { ProviderAccounts } from "./ProviderAccounts";
import { ProviderIcon } from "./ProviderIcon";
import { ProviderModels } from "./ProviderModels";
import { startProviderLogin } from "./provider-login";
import { refresh, rpc } from "./rpc";
import { showError, useStore } from "./store";
import {
  ClassificationSettings,
  ImageModelSettings,
} from "./UtilityModelSettings";

const filters = ["all", "connected", "oauth", "api_key", "extension"] as const;
type Filter = (typeof filters)[number];
const matchesFilter = (p: ProviderInfo, filter: Filter) =>
  filter === "all" ||
  (filter === "connected"
    ? p.configured || p.accounts?.some((account) => account.configured)
    : filter === "oauth"
      ? !!p.oauth
      : filter === "api_key"
        ? p.apiKey
        : p.extension);

export function Providers() {
  const t = useT();
  const providers = useStore((s) => s.bootstrap.providers);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const selected = useStore((s) => s.providerSelection);
  const select = (target: NonNullable<typeof selected>) =>
    useStore.setState({ providerSelection: target });
  const [category, setCategory] = useState("chat");
  const q = query.trim().toLowerCase();
  const matches = providers.filter(
    (p) =>
      matchesFilter(p, filter) &&
      (!q ||
        `${p.name} ${p.id} ${providerAccountSources(p)
          .map((account) => account.label)
          .join(" ")}`
          .toLowerCase()
          .includes(q)),
  );
  const groups = [
    {
      label: t.Connected,
      items: matches.filter((p) => matchesFilter(p, "connected")),
    },
    {
      label: t.Providers,
      items: matches.filter((p) => !matchesFilter(p, "connected")),
    },
  ].filter((group) => group.items.length);
  const current =
    matches.find((p) => p.id === selected?.provider) ?? groups[0]?.items[0];
  const account =
    current &&
    providerAccountSources(current).find(
      (entry) =>
        entry.accountId ===
        (current.id === selected?.provider ? selected.accountId : undefined),
    );
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
                    <ProviderAccounts
                      key={p.id}
                      provider={p}
                      selected={
                        current?.id === selected?.provider
                          ? selected
                          : { provider: current?.id ?? "" }
                      }
                      query={q}
                      onSelect={select}
                    />
                  ))}
                </section>
              ))}
              {!groups.length && (
                <p className="model-list-empty">{t["No matching providers"]}</p>
              )}
            </div>
          </div>
          {current && (
            <ProviderDetail
              key={account?.key ?? current.id}
              provider={current}
              account={account}
            />
          )}
        </div>
      )}
    </ContentPage>
  );
}

export function ProviderDetail({
  provider,
  account,
  children,
}: {
  provider: ProviderInfo;
  account?: AccountSource;
  children?: ReactNode;
}) {
  const target = { provider: provider.id, accountId: account?.accountId };
  const p = account?.accountId
    ? {
        ...provider,
        name: account.label,
        configured: account.configured,
        stored: account.configured,
        source: account.configured ? "OAuth" : undefined,
        apiKey: false,
      }
    : { ...provider, name: account?.label ?? provider.name };
  const titleId = useId();
  const t = useT();
  const login = useStore((s) => s.login);
  const [loggingOut, setLoggingOut] = useState(false);
  const mine =
    login?.provider === p.id &&
    login.accountId === account?.accountId &&
    !login.addAccount;
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
                if (mine && current) {
                  rpc.send.cancelLogin({ loginId: current.loginId });
                  useStore.setState({ login: undefined });
                }
                setLoggingOut(true);
                void rpc.request
                  .logout(target)
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
                  onClick={() => startProviderLogin(target, "oauth")}
                >
                  <LogIn size={14} /> {p.oauth.label ?? t["Sign in"]}
                </button>
              )}
              {p.apiKey && (
                <button
                  type="button"
                  className={p.oauth ? undefined : "primary"}
                  onClick={() => startProviderLogin(target, "api_key")}
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
