import { RotateCcw } from "lucide-react";
import { displayedEffort, effortLabels } from "../shared/effort";
import type { ModelOverride } from "../shared/model-overrides";
import { modelKey } from "../shared/models";
import type { Effort, ModelInfo } from "../shared/rpc-schema";
import { EffortSlider } from "./EffortSlider";
import { useT } from "./i18n";
import { refresh, rpc } from "./rpc";
import { showError, useStore } from "./store";
import { defaultEfforts, modelOverrides } from "./ui-mutations";

const contextPresets = [128_000, 200_000, 256_000, 500_000, 1_000_000];
const outputPresets = [8_000, 16_000, 32_000, 64_000, 128_000];
// Decimal units like provider docs: 128k = 128000.
export const formatTokens = (n: number) =>
  n >= 1_000_000
    ? `${+(n / 1_000_000).toFixed(2)}M`
    : n >= 1000
      ? `${+(n / 1000).toFixed(1)}k`
      : `${n}`;

function Reset({ onClick }: { onClick: () => void }) {
  const t = useT();
  return (
    <button
      type="button"
      className="model-setting-reset"
      aria-label={t["Reset to default"]}
      title={t["Reset to default"]}
      onClick={onClick}
    >
      <RotateCcw size={12} />
    </button>
  );
}

function TokenField({
  label,
  value,
  presets,
  overridden,
  onChange,
}: {
  label: string;
  value?: number;
  presets: number[];
  overridden: boolean;
  onChange: (value: number | undefined) => void;
}) {
  return (
    <fieldset className="model-setting">
      <legend>
        {label}
        {overridden && <Reset onClick={() => onChange(undefined)} />}
      </legend>
      <div className="model-setting-chips">
        {presets.map((preset) => (
          <button
            key={preset}
            type="button"
            aria-pressed={value === preset}
            onClick={() => onChange(preset)}
          >
            {formatTokens(preset)}
          </button>
        ))}
      </div>
      <input
        key={value}
        type="number"
        min={1}
        step={1}
        aria-label={label}
        defaultValue={value}
        onBlur={(event) => {
          const next = Number(event.target.value);
          if (Number.isInteger(next) && next > 0 && next !== value)
            onChange(next);
          else event.target.value = value === undefined ? "" : String(value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
      />
    </fieldset>
  );
}

export function ModelSettings({ model }: { model: ModelInfo }) {
  const t = useT();
  const override =
    useStore((s) => s.bootstrap.modelOverrides[modelKey(model)]) ?? {};
  function save(patch: Partial<ModelOverride>, replace = false) {
    const next = (replace ? patch : { ...override, ...patch }) as Record<
      string,
      unknown
    >;
    for (const key of Object.keys(next))
      if (next[key] === undefined) delete next[key];
    const key = modelKey(model);
    const confirmed = useStore.getState().bootstrap.modelOverrides[key] ?? {};
    // Shown at once; the derived model fields catch up after the write.
    void modelOverrides.change(
      key,
      confirmed,
      next as ModelOverride,
      (value) =>
        useStore.setState((state) => ({
          bootstrap: {
            ...state.bootstrap,
            modelOverrides: { ...state.bootstrap.modelOverrides, [key]: value },
          },
        })),
      async () => {
        await rpc.request.setModelOverride({
          provider: model.provider,
          id: model.id,
          override: next as ModelOverride,
        });
        void refresh().catch(showError);
        return next as ModelOverride;
      },
    );
  }
  function setDefaultEffort(effort: Effort | null) {
    const key = modelKey(model);
    const confirmed = model.defaultEffort ?? null;
    const original = {
      defaultEffort: model.defaultEffort,
      effectiveDefaultEffort: model.effectiveDefaultEffort,
    };
    const publish = (value: Effort | null) =>
      useStore.setState((state) => ({
        bootstrap: {
          ...state.bootstrap,
          models: state.bootstrap.models.map((item) =>
            modelKey(item) !== key
              ? item
              : value === confirmed
                ? { ...item, ...original }
                : value === null
                  ? { ...item, defaultEffort: undefined }
                  : {
                      ...item,
                      defaultEffort: value,
                      effectiveDefaultEffort: value,
                    },
          ),
        },
      }));
    return defaultEfforts.change(key, confirmed, effort, publish, async () => {
      await rpc.request.setDefaultEffort({
        provider: model.provider,
        id: model.id,
        effort,
      });
      // The inherited level after a reset is recomputed by the host.
      void refresh().catch(showError);
      return effort;
    });
  }
  const contextWindow = override.contextWindow ?? model.contextWindow;
  const maxTokens = override.maxTokens ?? model.maxTokens;
  const vision = override.input
    ? override.input.includes("image")
    : !!model.vision;
  const effortLevels = model.effortLevels ?? [];
  const adaptive =
    override.compat?.forceAdaptiveThinking ?? model.adaptiveThinking;
  return (
    <div className="model-settings">
      <label className="model-setting">
        <span className="model-setting-label">
          {t.Alias}
          {override.name && <Reset onClick={() => save({ name: undefined })} />}
        </span>
        <input
          key={override.name}
          defaultValue={override.name}
          placeholder={model.id}
          maxLength={60}
          onBlur={(event) => {
            const name = event.target.value.trim();
            if (name !== (override.name ?? ""))
              save({ name: name || undefined });
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
        />
      </label>
      <div className="model-setting-pair">
        <TokenField
          label={t["Context window"]}
          value={contextWindow}
          presets={contextPresets}
          overridden={override.contextWindow !== undefined}
          onChange={(contextWindow) => save({ contextWindow })}
        />
        <TokenField
          label={t["Max output"]}
          value={maxTokens}
          presets={outputPresets}
          overridden={override.maxTokens !== undefined}
          onChange={(maxTokens) => save({ maxTokens })}
        />
      </div>
      {effortLevels.length > 0 && (
        <fieldset className="model-setting">
          <legend>
            {t["Thinking levels"]}
            {override.thinkingLevelMap && (
              <Reset onClick={() => save({ thinkingLevelMap: undefined })} />
            )}
          </legend>
          <div className="model-setting-chips">
            {effortLevels.map((level) => (
              <span className="provider-tag" key={level}>
                {effortLabels[level]}
              </span>
            ))}
          </div>
        </fieldset>
      )}
      {effortLevels.length > 1 && (
        <div className="model-setting">
          <span className="model-setting-label">
            {t["Default reasoning effort"]}
            {model.defaultEffort ? (
              <Reset onClick={() => void setDefaultEffort(null)} />
            ) : (
              <small className="muted">{t.Inherited}</small>
            )}
          </span>
          <EffortSlider
            levels={effortLevels}
            value={displayedEffort(
              model.effectiveDefaultEffort ?? effortLevels[0],
              effortLevels,
            )}
            onCommit={(effort) => setDefaultEffort(effort)}
          />
        </div>
      )}
      {adaptive !== undefined && (
        <label className="model-setting model-setting-inline">
          <span className="model-setting-label">
            {t["Thinking protocol"]}
            {override.compat && (
              <Reset onClick={() => save({ compat: undefined })} />
            )}
          </span>
          <select
            value={adaptive ? "adaptive" : "standard"}
            onChange={(event) =>
              save({
                compat: {
                  forceAdaptiveThinking: event.target.value === "adaptive",
                },
              })
            }
          >
            <option value="standard">{t.Standard}</option>
            <option value="adaptive">{t.Adaptive}</option>
          </select>
        </label>
      )}
      <label className="provider-model-row model-setting-inline">
        <span className="provider-model-name">
          {t.Images}
          {override.input && (
            <Reset onClick={() => save({ input: undefined })} />
          )}
        </span>
        <input
          type="checkbox"
          role="switch"
          checked={vision}
          aria-checked={vision}
          onChange={(event) =>
            save({ input: event.target.checked ? ["text", "image"] : ["text"] })
          }
        />
        <span className="model-switch" aria-hidden="true" />
      </label>
      {Object.keys(override).length > 0 && (
        <button
          type="button"
          className="model-settings-reset-all"
          onClick={() => save({}, true)}
        >
          <RotateCcw size={12} /> {t["Reset all settings"]}
        </button>
      )}
    </div>
  );
}
