import {
  Brain,
  Check,
  ChevronDown,
  Clock3,
  Image,
  Search,
  Settings2,
  X,
} from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { effortLabels } from "../shared/effort";
import { filterModels, modelKey } from "../shared/models";
import type { ModelInfo, ModelSelection, Snapshot } from "../shared/rpc-schema";
import { EffortPicker } from "./EffortPicker";
import { EffortSlider } from "./EffortSlider";
import { useT } from "./i18n";
import { navigate } from "./navigation";
import { changeSelection, usePicker } from "./Picker";
import { ProviderIcon } from "./ProviderIcon";
import { requestSelection, rpc, updateUiPreferences } from "./rpc";
import { useStore } from "./store";

export function ModelPicker({
  snapshot,
  selection,
  onSelect,
}: {
  snapshot?: Snapshot;
  selection?: ModelSelection;
  onSelect?: (selection: ModelSelection) => void;
}) {
  const t = useT();
  const current = selection ?? snapshot ?? { effort: "off", effortLevels: [] };
  const { models, disabledModels, desktop, providers } = useStore(
    (state) => state.bootstrap,
  );
  const providerName = (id: string) =>
    providers.find((p) => p.id === id)?.name ?? id;
  const [query, setQuery] = useState("");
  const recent = desktop.recentModels ?? [];
  const [source, setSource] = useState(current.model?.provider);
  const [highlight, setHighlight] = useState(-1);
  const [open, setOpen] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const listId = useId();
  const { ref, close } = usePicker();
  const catalog = snapshot?.modelCatalog ?? models;
  const enabled = filterModels(catalog, disabledModels);
  const recentModels = recent.flatMap((key) => {
    const model = enabled.find((entry) => modelKey(entry) === key);
    return model ? [model] : [];
  });
  const sources = [
    ...(recentModels.length
      ? [{ id: "recent", label: t.Recent, count: recentModels.length }]
      : []),
    ...[
      ...new Set([
        ...providers.map((provider) => provider.id),
        ...enabled.map((model) => model.provider),
      ]),
    ].flatMap((id) => {
      const count = enabled.filter((model) => model.provider === id).length;
      return count ? [{ id, label: providerName(id), count }] : [];
    }),
  ];
  const activeSource = sources.some((entry) => entry.id === source)
    ? source
    : sources[0]?.id;
  const searching = !!query.trim();
  const visible = searching
    ? filterModels(catalog, disabledModels, query)
    : activeSource === "recent"
      ? recentModels
      : enabled.filter((model) => model.provider === activeSource);
  const selectedIndex = visible.findIndex(
    (model) => current.model && modelKey(model) === modelKey(current.model),
  );
  const activeIndex =
    highlight >= 0 && highlight < visible.length
      ? highlight
      : searching
        ? 0
        : selectedIndex;
  useEffect(() => {
    if (open && activeIndex >= 0)
      list.current
        ?.querySelector(`[data-model-index="${activeIndex}"]`)
        ?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex]);
  function select(model: ModelInfo) {
    const desired: ModelSelection = {
      model,
      effort: model.effectiveDefaultEffort ?? "off",
      effortLevels: model.effortLevels ?? [],
    };
    close();
    if (!snapshot || snapshot.ready === false) {
      onSelect?.(desired);
      return;
    }
    void changeSelection(snapshot.address, desired, () =>
      requestSelection(snapshot.address, () =>
        rpc.request.setModel({
          ...snapshot.address,
          provider: model.provider,
          id: model.id,
        }),
      ),
    ).then(() => {
      const chosen = useStore.getState().snapshots[snapshot.info.id]?.model;
      if (!chosen || modelKey(chosen) !== modelKey(model)) return;
      const previous = useStore.getState().bootstrap.desktop.recentModels ?? [];
      const next = [
        modelKey(model),
        ...previous.filter((key) => key !== modelKey(model)),
      ].slice(0, 6);
      updateUiPreferences({ recentModels: next });
    });
  }
  function selectSource(id: string) {
    setSource(id);
    setQuery("");
    setHighlight(-1);
    search.current?.focus();
  }
  return (
    <details
      className="picker model-picker"
      ref={ref}
      onToggle={() => {
        const isOpen = !!ref.current?.open;
        setOpen(isOpen);
        if (isOpen) search.current?.focus();
      }}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: Native summary is keyboard-interactive. */}
      <summary
        className="picker-trigger"
        aria-label={t.chooseModel(
          current.model?.name ?? t.None,
          effortLabels[current.effort],
        )}
        onClick={() => {
          if (!ref.current?.open) {
            setQuery("");
            setHighlight(-1);
            setSource(
              recentModels.length
                ? "recent"
                : (current.model?.provider ?? sources[0]?.id),
            );
          }
        }}
      >
        <span className="picker-model-label">
          {current.model?.name ?? t["Select model"]}
        </span>
        {current.effortLevels.length > 1 && (
          <span className="picker-effort-label">
            {effortLabels[current.effort]}
          </span>
        )}
        <ChevronDown size={12} />
      </summary>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: Keyboard events are delegated from native inputs and model buttons. */}
      <div
        className="picker-panel model-panel"
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.keyCode === 229) return;
          if (event.key === "Escape" && query) {
            event.preventDefault();
            event.stopPropagation();
            setQuery("");
            setHighlight(-1);
            search.current?.focus();
            return;
          }
          const target = event.target as HTMLElement;
          if (!target.matches("input, .model-option")) return;
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            const next =
              (activeIndex +
                (event.key === "ArrowDown" ? 1 : -1) +
                visible.length) %
              visible.length;
            if (!visible.length) return;
            setHighlight(next);
            if (target.matches(".model-option"))
              list.current
                ?.querySelector<HTMLButtonElement>(
                  `[data-model-index="${next}"]`,
                )
                ?.focus();
          }
          if (event.key === "Enter" && target === search.current) {
            event.preventDefault();
            const model = visible[Math.max(0, activeIndex)];
            if (model) select(model);
          }
        }}
      >
        <div className="model-search">
          <Search size={14} />
          <input
            ref={search}
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-activedescendant={
              open && visible[activeIndex]
                ? `${listId}-${activeIndex}`
                : undefined
            }
            aria-label={t["Search models"]}
            placeholder={t["Search models"]}
            spellCheck={false}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setHighlight(-1);
            }}
          />
          {query && (
            <button
              type="button"
              aria-label={t["Clear search"]}
              onClick={() => {
                setQuery("");
                setHighlight(-1);
                search.current?.focus();
              }}
            >
              <X size={12} />
            </button>
          )}
          <button
            type="button"
            aria-label={t["Manage models"]}
            title={t["Manage models"]}
            onClick={() => {
              close();
              navigate("providers");
            }}
          >
            <Settings2 size={14} />
          </button>
        </div>
        <div
          className="model-browser"
          data-has-rail={sources.length > 1 || undefined}
        >
          {sources.length > 1 && (
            <nav className="model-source-rail" aria-label={t["Model sources"]}>
              {sources.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  aria-pressed={activeSource === entry.id && !searching}
                  onClick={() => selectSource(entry.id)}
                >
                  {entry.id === "recent" ? (
                    <Clock3 size={12} />
                  ) : (
                    <ProviderIcon provider={entry.id} size={12} />
                  )}
                  <span>{entry.label}</span>
                  <small>{entry.count}</small>
                </button>
              ))}
            </nav>
          )}
          <div
            className="model-results"
            id={listId}
            ref={list}
            role="listbox"
            aria-label={t.Models}
          >
            {visible.map((model, index) => {
              const selected =
                current.model && modelKey(model) === modelKey(current.model);
              const showGroup =
                searching &&
                (index === 0 || visible[index - 1].provider !== model.provider);
              return (
                <div key={modelKey(model)}>
                  {showGroup && (
                    <div className="picker-group-title">
                      {providerName(model.provider)}
                    </div>
                  )}
                  <button
                    type="button"
                    className="model-option"
                    role="option"
                    aria-selected={!!selected}
                    data-highlighted={index === activeIndex || undefined}
                    data-model-index={index}
                    id={`${listId}-${index}`}
                    title={`${model.name}\n${model.id}`}
                    onPointerMove={() => setHighlight(index)}
                    onClick={() => select(model)}
                  >
                    <span className="model-option-name">{model.name}</span>
                    <span className="model-capabilities">
                      {model.reasoning && (
                        <Brain size={12} aria-label={t.Reasoning} />
                      )}
                      {model.vision && (
                        <Image size={12} aria-label={t.Images} />
                      )}
                      {model.contextWindow && (
                        <small>{Math.round(model.contextWindow / 1000)}k</small>
                      )}
                    </span>
                    <span className="model-selected-mark">
                      {selected && <Check size={13} />}
                    </span>
                  </button>
                </div>
              );
            })}
            {!visible.length && (
              <p className="picker-empty">
                {searching
                  ? t["No matching models"]
                  : enabled.length
                    ? t["No recent models"]
                    : t["Enable models in provider settings"]}
              </p>
            )}
          </div>
        </div>
        {!snapshot && onSelect && (
          <EffortSlider
            levels={current.effortLevels}
            value={current.effort}
            onCommit={async (effort) =>
              onSelect({
                model: current.model,
                effort,
                effortLevels: current.effortLevels,
              })
            }
          />
        )}
        {snapshot && (
          <EffortPicker
            key={`${current.model?.provider}/${current.model?.id}/${current.effortLevels.join()}`}
            snapshot={snapshot}
          />
        )}
      </div>
    </details>
  );
}
