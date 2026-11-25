import {
  Brain,
  Check,
  ChevronDown,
  Clock3,
  Image,
  Lock,
  LogIn,
  SquarePen,
  Zap,
} from "lucide-react";
import {
  type FocusEvent,
  memo,
  type PointerEvent,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  accountModelKey,
  accountSourceKey,
  providerAccountSources,
  selectionKey,
} from "../shared/account-models";
import { effortLabels } from "../shared/effort";
import type { ModelSelection } from "../shared/rpc-schema";
import {
  type AccountModel,
  accountLocked,
  accountModelSources,
} from "./account-picker";
import { EffortChip } from "./EffortChip";
import { EffortPicker } from "./EffortPicker";
import { EffortSlider } from "./EffortSlider";
import { useT } from "./i18n";
import type { ModelPickerSnapshot } from "./model-picker-view";
import { changeSelection, usePicker } from "./Picker";
import { ProviderIcon } from "./primitives/ProviderIcon";
import { SearchField } from "./primitives/SearchField";
import { startProviderLogin } from "./provider-login";
import {
  ensureSessionRuntime,
  openChat,
  requestSelection,
  rpc,
  updateSettings,
  updateUiPreferences,
} from "./rpc";
import { showError, useStore } from "./store";
import { useTooltip } from "./Tooltip";
import "./provider-accounts.css";

/** Keeps the panel inside the pane that clips it (panes hide overflow). */
function usePanelRoom(
  open: boolean,
  picker: { current: HTMLElement | null },
  panel: { current: HTMLElement | null },
) {
  useLayoutEffect(() => {
    const anchor = picker.current;
    if (!open || !anchor) return;
    const bounds = anchor.closest<HTMLElement>(".pane-view");
    const fit = () => {
      const left = bounds?.getBoundingClientRect().left ?? 0;
      panel.current?.style.setProperty(
        "--model-panel-room",
        `${Math.floor(anchor.getBoundingClientRect().right - left - 8)}px`,
      );
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(anchor);
    if (bounds) observer.observe(bounds);
    return () => observer.disconnect();
  }, [open, picker, panel]);
}

/** Scrolls the highlighted model name when it is cut off. */
function updateMarquee(row: Element | null | undefined) {
  const name = row?.querySelector<HTMLElement>(".model-option-name");
  if (!name) return;
  const distance = name.scrollWidth - name.clientWidth;
  if (distance <= 1) {
    delete name.dataset.overflow;
    return;
  }
  name.dataset.overflow = "";
  name.style.setProperty("--marquee-distance", `${distance}px`);
  name.style.setProperty(
    "--marquee-duration",
    `${(2 + distance / 30).toFixed(2)}s`,
  );
}

export const ModelPicker = memo(function ModelPicker({
  snapshot,
  selection,
  onSelect,
}: {
  snapshot?: ModelPickerSnapshot;
  selection?: ModelSelection;
  onSelect?: (selection: ModelSelection) => void;
}) {
  const t = useT();
  const current = selection ?? snapshot ?? { effort: "off", effortLevels: [] };
  const bootstrap = useStore((state) => state.bootstrap);
  const fastMode = useStore((state) => state.settings.fastMode);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (open && snapshot?.suspended)
      void ensureSessionRuntime(snapshot.address).catch(showError);
  }, [open, snapshot?.suspended, snapshot?.address]);
  const sources = useMemo(
    () => (open ? accountModelSources(bootstrap, snapshot) : []),
    [open, bootstrap, snapshot],
  );
  const choices = useMemo(
    () =>
      sources.flatMap((source) =>
        source.configured
          ? source.models.map((model) => ({ source, model }))
          : [],
      ),
    [sources],
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
  // The closed trigger needs an account label, never the model catalog.
  const provider = bootstrap.providers.find(
    (entry) => entry.id === current.model?.provider,
  );
  const currentLabel = provider
    ? providerAccountSources(provider).find(
        (entry) => entry.accountId === current.accountId,
      )?.label
    : current.model?.provider;
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<string>();
  const [highlight, setHighlight] = useState(-1);
  const search = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const listId = useId();
  const { ref, close } = usePicker();
  const panel = useRef<HTMLDivElement>(null);
  usePanelRoom(open, ref, panel);
  const tooltip = useTooltip();
  // The rail shows only icons in narrow panels; then the name moves to a Tooltip.
  const railTip = (label: string, description?: string) => {
    const props: {
      onPointerEnter?: (event: PointerEvent<HTMLElement>) => void;
      onFocus?: (event: FocusEvent<HTMLElement>) => void;
    } = tooltip({
      tier: description ? "detail" : "label",
      label,
      description,
      side: "right",
    });
    const compact = (el: HTMLElement) => {
      const text = el.querySelector(":scope > span");
      return !text || getComputedStyle(text).display === "none";
    };
    return {
      ...props,
      onPointerEnter: (event: PointerEvent<HTMLElement>) => {
        if (compact(event.currentTarget)) props.onPointerEnter?.(event);
      },
      onFocus: (event: FocusEvent<HTMLElement>) => {
        if (compact(event.currentTarget)) props.onFocus?.(event);
      },
    };
  };
  const activeKey =
    (!source || source === "recent") && recent.length
      ? "recent"
      : sources.some((entry) => entry.key === source)
        ? source
        : (currentSource?.key ?? sources[0]?.key);
  const activeSource = sources.find((entry) => entry.key === activeKey);
  const needle = query.trim().toLowerCase();
  const searching = !!needle;
  const visible = searching
    ? choices.filter(({ source, model }) =>
        `${source.label} ${model.name} ${model.id} ${model.provider}`
          .toLowerCase()
          .includes(needle),
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
  const virtual = open && visible.length > 80 && !locked;
  const rows = useVirtualizer({
    enabled: virtual,
    count: visible.length,
    getScrollElement: () => list.current,
    getItemKey: (i) => choiceKey(visible[i]),
    estimateSize: () => 32,
    overscan: 5,
  });
  const windowRows = virtual ? rows.getVirtualItems() : undefined;
  const focusRow = useRef(false);
  useEffect(() => {
    if (open && activeIndex >= 0) {
      if (virtual) rows.scrollToIndex(activeIndex, { align: "auto" });
      else
        list.current
          ?.querySelector(`[data-model-index="${activeIndex}"]`)
          ?.scrollIntoView({ block: "nearest" });
    }
  }, [open, activeIndex, virtual, rows]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Re-measure when the highlighted row or list changes.
  useLayoutEffect(() => {
    if (open && activeIndex >= 0) {
      const option = list.current?.querySelector<HTMLButtonElement>(
        `[data-model-index="${activeIndex}"]`,
      );
      updateMarquee(option);
      if (option && focusRow.current) {
        option.focus({ preventScroll: true });
        focusRow.current = false;
      }
    }
  }, [open, activeIndex, query, activeKey, windowRows]);
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
          `${currentLabel ?? ""} ${current.model?.name ?? t.None}`.trim(),
          effortLabels[current.effort],
        )}
        onClick={() => {
          if (!ref.current?.open) {
            setQuery("");
            setHighlight(-1);
            setSource(undefined);
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
          ref={panel}
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
              focusRow.current = target.matches(".model-option");
            }
            if (event.key === "Enter" && target === search.current) {
              event.preventDefault();
              const choice = visible[Math.max(0, activeIndex)];
              if (choice) select(choice);
            }
          }}
        >
          <SearchField
            variant="inline"
            className="model-search"
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
            onClear={() => {
              setQuery("");
              setHighlight(-1);
              search.current?.focus();
            }}
            clearLabel={t["Clear search"]}
          >
            <button
              type="button"
              aria-label={t["Fast mode"]}
              aria-pressed={fastMode}
              disabled={!current.model?.fastMode}
              onClick={() => updateSettings({ fastMode: !fastMode })}
            >
              <Zap size={14} />
            </button>
          </SearchField>
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
                    aria-label={t.Recent}
                    {...railTip(t.Recent)}
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
                    aria-label={entry.label}
                    {...railTip(
                      entry.label,
                      accountLocked(entry, snapshot)
                        ? t.accountLocked
                        : !entry.configured
                          ? t.accountSignInNeeded(entry.label)
                          : undefined,
                    )}
                  >
                    <ProviderIcon provider={entry.provider} size={12} />
                    <span>{entry.label}</span>
                    {accountLocked(entry, snapshot) ? (
                      <Lock
                        size={10}
                        className="model-source-lock"
                        aria-label={t.accountLocked}
                      />
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
                  {windowRows && (
                    <div
                      aria-hidden
                      style={{ height: windowRows[0]?.start ?? 0 }}
                    />
                  )}
                  {(windowRows ?? visible).map((_, i) => {
                    const index = windowRows?.[i].index ?? i;
                    const choice = visible[index];
                    const { model, source } = choice;
                    const selected =
                      choiceKey(choice) === selectionKey(current);
                    const showGroup =
                      searching &&
                      (index === 0 ||
                        visible[index - 1].source.key !== source.key);
                    return (
                      <div
                        key={choiceKey(choice)}
                        data-index={index}
                        ref={virtual ? rows.measureElement : undefined}
                      >
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
                          aria-description={`${source.label}\n${model.name}\n${model.id}`}
                          onPointerMove={() => setHighlight(index)}
                          onClick={() => select(choice)}
                        >
                          {!searching && activeKey === "recent" && (
                            <ProviderIcon
                              provider={source.provider}
                              size={12}
                            />
                          )}
                          <span className="model-option-name">
                            <span>{model.name}</span>
                          </span>
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
                  {windowRows && (
                    <div
                      aria-hidden
                      style={{
                        height:
                          rows.getTotalSize() - (windowRows.at(-1)?.end ?? 0),
                      }}
                    />
                  )}
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

import { useVirtualizer } from "@tanstack/react-virtual";
