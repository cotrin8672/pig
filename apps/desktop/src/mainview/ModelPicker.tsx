import {
  Brain,
  Check,
  ChevronDown,
  Clock3,
  Image,
  Lock,
  LogIn,
  Search,
  Settings2,
  SquarePen,
  X,
} from "lucide-react";
import { memo, useEffect, useId, useRef, useState } from "react";
import {
  accountModelKey,
  accountSourceKey,
  selectionKey,
} from "../shared/account-models";
import { effortLabels } from "../shared/effort";
import type { ModelSelection, Snapshot } from "../shared/rpc-schema";
import {
  type AccountModel,
  accountLocked,
  accountModelSources,
} from "./account-picker";
import { EffortChip } from "./EffortChip";
import { EffortPicker } from "./EffortPicker";
import { EffortSlider } from "./EffortSlider";
import { useT } from "./i18n";
import { navigate } from "./navigation";
import { changeSelection, usePicker } from "./Picker";
import { ProviderIcon } from "./ProviderIcon";
import { startProviderLogin } from "./provider-login";
import { openChat, requestSelection, rpc, updateUiPreferences } from "./rpc";
import { useStore } from "./store";
import "./provider-accounts.css";

export const ModelPicker = memo(function ModelPicker({
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
  const bootstrap = useStore((state) => state.bootstrap);
  const sources = accountModelSources(bootstrap, snapshot);
  const choices = sources.flatMap((source) =>
    source.configured ? source.models.map((model) => ({ source, model })) : [],
  );
  const choiceKey = ({ source, model }: AccountModel) =>
    accountModelKey(model, source.accountId);
  const recent = (bootstrap.desktop.recentModels ?? []).flatMap((key) => {
    const choice = choices.find((choice) => choiceKey(choice) === key);
    return choice ? [choice] : [];
  });
  const currentSource = sources.find(
    (source) =>
      source.key ===
      accountSourceKey(current.model?.provider ?? "", current.accountId),
  );
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<string>();
  const [highlight, setHighlight] = useState(-1);
  const [open, setOpen] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const listId = useId();
  const { ref, close } = usePicker();
  const activeKey =
    source === "recent" && recent.length
      ? source
      : sources.some((entry) => entry.key === source)
        ? source
        : (currentSource?.key ?? sources[0]?.key);
  const activeSource = sources.find((entry) => entry.key === activeKey);
  const searching = !!query.trim();
  const visible = searching
    ? choices.filter(({ source, model }) =>
        `${source.label} ${model.name} ${model.id} ${model.provider}`
          .toLowerCase()
          .includes(query.trim().toLowerCase()),
      )
    : activeKey === "recent"
      ? recent
      : choices.filter((choice) => choice.source.key === activeKey);
  const selectedIndex = visible.findIndex(
    (choice) => choiceKey(choice) === selectionKey(current),
  );
  const activeIndex =
    highlight >= 0 && highlight < visible.length
      ? highlight
      : searching
        ? 0
        : selectedIndex;
  useEffect(() => {
    if (open) search.current?.focus();
  }, [open]);
  const locked = activeSource && accountLocked(activeSource, snapshot);
  const signedOut = activeSource && !activeSource.configured;
  useEffect(() => {
    if (open && activeIndex >= 0)
      list.current
        ?.querySelector(`[data-model-index="${activeIndex}"]`)
        ?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex]);
  function desired({ source, model }: AccountModel): ModelSelection {
    return {
      model,
      accountId: source.accountId,
      effort: model.effectiveDefaultEffort ?? "off",
      effortLevels: model.effortLevels ?? [],
    };
  }
  function select(choice: AccountModel) {
    if (accountLocked(choice.source, snapshot)) return;
    const next = desired(choice);
    close();
    if (!snapshot || snapshot.ready === false) {
      onSelect?.(next);
      return;
    }
    void changeSelection(snapshot.address, next, () =>
      requestSelection(snapshot.address, () =>
        rpc.request.setModel({
          ...snapshot.address,
          provider: choice.model.provider,
          id: choice.model.id,
          accountId: choice.source.accountId ?? null,
        }),
      ),
    ).then(() => {
      const confirmed = useStore.getState().snapshots[snapshot.info.id];
      if (!confirmed || selectionKey(confirmed) !== choiceKey(choice)) return;
      const previous = useStore.getState().bootstrap.desktop.recentModels ?? [];
      updateUiPreferences({
        recentModels: [
          choiceKey(choice),
          ...previous.filter((key) => key !== choiceKey(choice)),
        ].slice(0, 6),
      });
    });
  }
  function selectSource(key: string) {
    setSource(key);
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
          `${currentSource?.label ?? ""} ${current.model?.name ?? t.None}`.trim(),
          effortLabels[current.effort],
        )}
        title={[
          currentSource?.label ?? current.accountId,
          current.model?.name,
          current.effortLevels.length > 1 && effortLabels[current.effort],
        ]
          .filter(Boolean)
          .join(" / ")}
        onClick={() => {
          if (!ref.current?.open) {
            setQuery("");
            setHighlight(-1);
            setSource(
              recent.length
                ? "recent"
                : (currentSource?.key ?? sources[0]?.key),
            );
          }
        }}
      >
        {current.model && (
          <ProviderIcon provider={current.model.provider} size={12} />
        )}
        <span className="picker-model-label">
          {current.model?.name ?? t["Select model"]}
        </span>
        <EffortChip levels={current.effortLevels} effort={current.effort} />
        <ChevronDown size={12} />
      </summary>
      {open && (
        // biome-ignore lint/a11y/noStaticElementInteractions: Keyboard events are delegated from inputs and options.
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
            if (
              (event.key === "ArrowDown" || event.key === "ArrowUp") &&
              visible.length
            ) {
              event.preventDefault();
              const next =
                (activeIndex +
                  (event.key === "ArrowDown" ? 1 : -1) +
                  visible.length) %
                visible.length;
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
              const choice = visible[Math.max(0, activeIndex)];
              if (choice) select(choice);
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
            data-has-rail={
              sources.length + (recent.length ? 1 : 0) > 1 || undefined
            }
          >
            {sources.length + (recent.length ? 1 : 0) > 1 && (
              <nav
                className="model-source-rail"
                aria-label={t["Model sources"]}
              >
                {!!recent.length && (
                  <button
                    type="button"
                    aria-pressed={activeKey === "recent" && !searching}
                    onClick={() => selectSource("recent")}
                  >
                    <Clock3 size={12} />
                    <span>{t.Recent}</span>
                    <small>{recent.length}</small>
                  </button>
                )}
                {sources.map((entry) => (
                  <button
                    key={entry.key}
                    type="button"
                    aria-pressed={activeKey === entry.key && !searching}
                    data-unavailable={
                      !entry.configured ||
                      accountLocked(entry, snapshot) ||
                      undefined
                    }
                    onClick={() => selectSource(entry.key)}
                    title={entry.label}
                  >
                    <ProviderIcon provider={entry.provider} size={12} />
                    <span>{entry.label}</span>
                    {accountLocked(entry, snapshot) ? (
                      <Lock size={10} aria-label={t.accountLocked} />
                    ) : (
                      <small>
                        {entry.configured ? entry.models.length : "!"}
                      </small>
                    )}
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
              {!searching && signedOut && activeSource ? (
                <div className="model-account-action">
                  <p>{t.accountSignInNeeded(activeSource.label)}</p>
                  <button
                    type="button"
                    onClick={() => {
                      close();
                      startProviderLogin({
                        provider: activeSource.provider,
                        accountId: activeSource.accountId,
                      });
                    }}
                  >
                    <LogIn size={13} />
                    {t["Sign in"]}
                  </button>
                </div>
              ) : (
                <>
                  {!searching && locked && activeSource && (
                    <div className="model-account-action">
                      <p>{t.accountLocked}</p>
                      <button
                        type="button"
                        onClick={() => {
                          const model = activeSource.models[0];
                          if (!model || !snapshot) return;
                          close();
                          void openChat(
                            snapshot.info.cwd,
                            undefined,
                            true,
                            desired({ source: activeSource, model }),
                          );
                        }}
                        disabled={!activeSource.models.length}
                      >
                        <SquarePen size={13} />
                        {t.newChatWithAccount(activeSource.label)}
                      </button>
                    </div>
                  )}
                  {visible.map((choice, index) => {
                    const { model, source } = choice;
                    const selected =
                      choiceKey(choice) === selectionKey(current);
                    const showGroup =
                      searching &&
                      (index === 0 ||
                        visible[index - 1].source.key !== source.key);
                    return (
                      <div key={choiceKey(choice)}>
                        {showGroup && (
                          <div className="picker-group-title">
                            {source.label}
                          </div>
                        )}
                        <button
                          type="button"
                          className="model-option"
                          role="option"
                          aria-selected={selected}
                          aria-disabled={
                            accountLocked(source, snapshot) || undefined
                          }
                          data-highlighted={index === activeIndex || undefined}
                          data-model-index={index}
                          id={`${listId}-${index}`}
                          title={`${source.label}\n${model.name}\n${model.id}`}
                          onPointerMove={() => setHighlight(index)}
                          onClick={() => select(choice)}
                        >
                          <span className="model-option-name">
                            {model.name}
                          </span>
                          {!searching && activeKey === "recent" && (
                            <small className="picker-account-label">
                              {source.label}
                            </small>
                          )}
                          <span className="model-capabilities">
                            {model.reasoning && (
                              <Brain size={12} aria-label={t.Reasoning} />
                            )}
                            {model.vision && (
                              <Image size={12} aria-label={t.Images} />
                            )}
                            {model.contextWindow && (
                              <small>
                                {Math.round(model.contextWindow / 1000)}k
                              </small>
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
                        : t["Enable models in provider settings"]}
                    </p>
                  )}
                </>
              )}
            </div>
          </div>
          {!snapshot && onSelect && (
            <EffortSlider
              levels={current.effortLevels}
              value={current.effort}
              onCommit={async (effort) => onSelect({ ...current, effort })}
            />
          )}
          {snapshot && (
            <EffortPicker
              key={`${current.model?.provider}/${current.model?.id}/${current.effortLevels.join()}`}
              snapshot={snapshot}
            />
          )}
        </div>
      )}
    </details>
  );
});
