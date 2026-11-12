import { ChevronDown, Search } from "lucide-react";
import { useId, useState } from "react";
import type { UtilityModelInfo } from "../shared/rpc-schema";
import { useT } from "./i18n";
import { ProviderIcon } from "./ProviderIcon";
import { ProviderDetail } from "./Providers";
import { updateSettings } from "./rpc";
import { useStore } from "./store";
import "./settings.css";

type Selection = { provider: string; id: string } | null;
const selectionKey = (model: Selection) =>
  model ? JSON.stringify([model.provider, model.id]) : "";

export function ModelSelect({
  label,
  models,
  value,
  onChange,
  emptyLabel,
}: {
  label: string;
  models: UtilityModelInfo[];
  value: Selection;
  onChange: (value: Selection) => void;
  emptyLabel?: string;
}) {
  const t = useT();
  const id = useId();
  const providers = useStore((s) => s.bootstrap.providers);
  const [query, setQuery] = useState("");
  const key = selectionKey(value);
  const available =
    !value || models.some((model) => selectionKey(model) === key);
  const q = query.trim().toLowerCase();
  const name = (provider: string) =>
    providers.find((p) => p.id === provider)?.name ?? provider;
  const visible = models.filter(
    (model) =>
      selectionKey(model) === key ||
      `${model.name} ${model.id} ${name(model.provider)}`
        .toLowerCase()
        .includes(q),
  );
  const groups = [...new Set(visible.map((model) => model.provider))];
  return (
    <div className="settings-card utility-model-select">
      <label htmlFor={id}>{label}</label>
      <div className="settings-search">
        <Search size={14} aria-hidden="true" />
        <input
          aria-label={t["Search models"]}
          placeholder={t["Search models"]}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <div className="settings-select">
        <select
          id={id}
          value={key}
          onChange={(event) => {
            const model = models.find(
              (item) => selectionKey(item) === event.target.value,
            );
            onChange(model ? { provider: model.provider, id: model.id } : null);
          }}
        >
          <option value="">{emptyLabel ?? t.None}</option>
          {!available && value && (
            <option value={key} disabled>
              {name(value.provider)} / {value.id} — {t["Model unavailable"]}
            </option>
          )}
          {groups.map((provider) => (
            <optgroup key={provider} label={name(provider)}>
              {visible
                .filter((model) => model.provider === provider)
                .map((model) => (
                  <option key={selectionKey(model)} value={selectionKey(model)}>
                    {model.name} ({model.id})
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
        <ChevronDown size={14} aria-hidden="true" />
      </div>
      {!available && (
        <p className="settings-hint" role="status">
          {t["Reconnect the provider to use the saved model."]}
        </p>
      )}
      {!models.length && (
        <p className="settings-hint">
          {t["No connected models for this task."]}
        </p>
      )}
      {!!models.length && !visible.length && (
        <p className="settings-hint">{t["No matching models"]}</p>
      )}
    </div>
  );
}

export function ImageModelSettings({ onConnect }: { onConnect: () => void }) {
  const t = useT();
  const models = useStore((s) => s.bootstrap.imageModels);
  const selected = useStore((s) => s.settings.imageGenerationModel ?? null);
  return (
    <>
      <ModelSelect
        label={t["Image generation model"]}
        models={models ?? []}
        value={selected}
        onChange={(imageGenerationModel) =>
          updateSettings({ imageGenerationModel })
        }
      />
      <p className="settings-hint">
        {t["Choose an image generation model from connected providers."]}
      </p>
      <button
        className="utility-provider-link"
        type="button"
        onClick={onConnect}
      >
        {t["Connect a provider"]}
      </button>
    </>
  );
}

export function ClassificationSettings() {
  const t = useT();
  const {
    providers,
    classificationModels = [],
    classificationProviders = [],
  } = useStore((s) => s.bootstrap);
  const model = useStore((s) => s.settings.classificationModel ?? null);
  const [selected, setSelected] = useState<string>();
  const candidates = providers
    .filter((p) => classificationProviders.includes(p.id))
    .sort(
      (a, b) =>
        Number(b.configured) - Number(a.configured) ||
        a.name.localeCompare(b.name),
    );
  const current =
    candidates.find((p) => p.id === (selected ?? model?.provider)) ??
    candidates[0];
  return (
    <>
      <ModelSelect
        label={t["Classification model"]}
        models={classificationModels}
        value={model}
        onChange={(classificationModel) =>
          updateSettings({ classificationModel })
        }
      />
      <p className="settings-hint">
        {
          t[
            "Connect a classification provider, then choose a model such as Jev. Credentials are shared with Providers."
          ]
        }
      </p>
      <nav
        className="classification-providers"
        aria-label={t["Classification providers"]}
      >
        {candidates.map((provider) => (
          <button
            key={provider.id}
            type="button"
            aria-pressed={current?.id === provider.id}
            onClick={() => setSelected(provider.id)}
          >
            <ProviderIcon provider={provider.id} size={16} />
            {provider.name}
            {provider.configured && (
              <span
                className="provider-dot"
                role="img"
                aria-label={t.Connected}
              />
            )}
          </button>
        ))}
      </nav>
      {current ? (
        <div className="settings-card utility-provider">
          <ProviderDetail key={current.id} provider={current}>
            {false}
          </ProviderDetail>
        </div>
      ) : (
        <p className="settings-hint">
          {t["No classification providers available."]}
        </p>
      )}
    </>
  );
}
