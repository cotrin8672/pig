import { ChevronDown, RefreshCw, Search, X } from "lucide-react";
import { useRef, useState } from "react";
import {
  isModelEnabled,
  modelKey,
  replaceModelVisibility,
} from "../shared/models";
import { useT } from "./i18n";
import { formatTokens, ModelSettings } from "./ModelSettings";
import { useProviderName } from "./ProviderIcon";
import { refresh, rpc } from "./rpc";
import { showError, useStore } from "./store";
import { modelVisibility } from "./ui-mutations";

export function ProviderModels({
  provider,
  connected,
}: {
  provider: string;
  connected: boolean;
}) {
  const t = useT();
  const { models, disabledModels } = useStore((s) => s.bootstrap);
  const name = useProviderName(provider);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string>();
  const [refreshing, setRefreshing] = useState(false);
  const refreshingRef = useRef(false);
  const group = models.filter((model) => model.provider === provider);
  const visible = group.filter((model) =>
    `${model.name} ${model.id}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  const enabledCount = group.filter((model) =>
    isModelEnabled(model, disabledModels),
  ).length;
  const visibleEnabledCount = visible.filter((model) =>
    isModelEnabled(model, disabledModels),
  ).length;
  const allVisibleEnabled =
    visible.length > 0 && visibleEnabledCount === visible.length;
  const partiallyEnabled =
    visibleEnabledCount > 0 && visibleEnabledCount < visible.length;
  async function update(ids: string[], enabled: boolean) {
    const keys = ids.map((id) => modelKey({ provider, id }));
    if (!keys.length) return;
    const allKeys = group.map(modelKey);
    const before = useStore
      .getState()
      .bootstrap.disabledModels.filter((key) => allKeys.includes(key));
    const desired = replaceModelVisibility(before, keys, enabled ? [] : keys);
    const merge = (disabled: string[]) =>
      useStore.setState((state) => ({
        bootstrap: {
          ...state.bootstrap,
          disabledModels: replaceModelVisibility(
            state.bootstrap.disabledModels,
            allKeys,
            disabled,
          ),
        },
      }));
    await modelVisibility.change(provider, before, desired, merge, async () => {
      try {
        for (const value of [true, false]) {
          const ids = group
            .filter((model) => desired.includes(modelKey(model)) !== value)
            .map((model) => model.id);
          for (let start = 0; start < ids.length; start += 1000)
            await rpc.request.setModelsEnabled({
              provider,
              ids: ids.slice(start, start + 1000),
              enabled: value,
            });
        }
        return desired;
      } catch (error) {
        showError(error);
        return (await rpc.request.bootstrap()).disabledModels.filter((key) =>
          allKeys.includes(key),
        );
      }
    });
  }
  async function refreshModels() {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setRefreshing(true);
    try {
      await rpc.request.refreshProviderModels({ provider });
      await refresh();
    } catch (error) {
      showError(error);
    } finally {
      refreshingRef.current = false;
      setRefreshing(false);
    }
  }
  return (
    <fieldset
      className="provider-model-panel"
      aria-label={t.providerModels(name)}
    >
      <div className="provider-section-heading">
        <h3>{t.Models}</h3>
        {!!group.length && (
          <small title={t.modelsEnabled(enabledCount, group.length)}>
            {enabledCount}/{group.length}
          </small>
        )}
        <button
          type="button"
          className="provider-model-refresh"
          data-refreshing={refreshing || undefined}
          aria-busy={refreshing}
          aria-label={
            refreshing ? t["Refreshing models…"] : t["Refresh models"]
          }
          title={refreshing ? t["Refreshing models…"] : t["Refresh models"]}
          disabled={refreshing}
          onClick={() => void refreshModels()}
        >
          <RefreshCw
            size={14}
            className="provider-model-refresh-icon"
            aria-hidden="true"
          />
        </button>
      </div>
      {!group.length ? (
        <p className="model-list-empty">
          {connected
            ? t["No models available"]
            : t["Connect this provider to choose its models."]}
        </p>
      ) : (
        <>
          <div className="provider-model-toolbar">
            <div className="provider-model-search">
              <Search size={13} />
              <input
                aria-label={t.searchProviderModels(name)}
                placeholder={t["Filter models"]}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              {query && (
                <button
                  type="button"
                  aria-label={t["Clear model filter"]}
                  onClick={() => setQuery("")}
                >
                  <X size={12} />
                </button>
              )}
            </div>
            <span className="provider-model-count">
              {query.trim()
                ? t.modelCount(visible.length, true)
                : t.modelCount(group.length, false)}
            </span>
          </div>
          <label className="provider-model-row provider-model-select-all">
            <span className="provider-model-name">
              {query.trim() ? t["All matching models"] : t["All models"]}
            </span>
            <input
              type="checkbox"
              role="switch"
              checked={allVisibleEnabled}
              aria-checked={partiallyEnabled ? "mixed" : allVisibleEnabled}
              disabled={!visible.length}
              onChange={(event) =>
                void update(
                  visible.map((model) => model.id),
                  event.target.checked,
                )
              }
            />
            <span
              className="model-switch"
              data-mixed={partiallyEnabled || undefined}
              aria-hidden="true"
            />
          </label>
          <div className="provider-model-list">
            {visible.map((model) => {
              const key = modelKey(model);
              const expanded = open === key;
              return (
                <div className="provider-model-item" key={key}>
                  <div className="provider-model-line">
                    <label className="provider-model-row" title={model.id}>
                      <span className="provider-model-name">{model.name}</span>
                      {model.contextWindow && (
                        <small className="provider-model-limits">
                          {formatTokens(model.contextWindow)}
                          {model.maxTokens &&
                            ` · ${formatTokens(model.maxTokens)}`}
                        </small>
                      )}
                      <input
                        type="checkbox"
                        role="switch"
                        checked={isModelEnabled(model, disabledModels)}
                        aria-checked={isModelEnabled(model, disabledModels)}
                        onChange={(event) =>
                          void update([model.id], event.target.checked)
                        }
                      />
                      <span className="model-switch" aria-hidden="true" />
                    </label>
                    <button
                      type="button"
                      className="provider-model-expand"
                      aria-expanded={expanded}
                      aria-label={t.modelSettings(model.name)}
                      title={t.modelSettings(model.name)}
                      onClick={() => setOpen(expanded ? undefined : key)}
                    >
                      <ChevronDown size={14} />
                    </button>
                  </div>
                  {expanded && <ModelSettings model={model} />}
                </div>
              );
            })}
            {!visible.length && (
              <p className="model-list-empty">{t["No matching models"]}</p>
            )}
          </div>
        </>
      )}
    </fieldset>
  );
}
