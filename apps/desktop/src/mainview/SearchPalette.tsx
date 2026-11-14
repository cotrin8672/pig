import {
  FolderPlus,
  LayoutGrid,
  MessageSquare,
  MessageSquareText,
  Search,
  SlidersHorizontal,
  Zap,
} from "lucide-react";
import {
  Fragment,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useShallow } from "zustand/react/shallow";
import { searchTerms } from "../shared/fuzzy";
import type { ConversationHit } from "../shared/rpc-schema";
import { useT } from "./i18n";
import { navigate } from "./navigation";
import { openChat, rpc } from "./rpc";
import {
  messageItems,
  type PaletteKind,
  type PaletteTarget,
  paletteItems,
  type RankedItem,
  rankItems,
} from "./search-items";
import { runAction } from "./shortcuts";
import { showError, useStore } from "./store";
import "./search-palette.css";

const icons: Record<PaletteKind, typeof Search> = {
  chat: MessageSquare,
  project: FolderPlus,
  page: LayoutGrid,
  action: Zap,
  setting: SlidersHorizontal,
  message: MessageSquareText,
};
const DEBOUNCE_MS = 80;
const INDEXING_POLL_MS = 500;

/** Rendered only while open, so the closed palette costs nothing. */
export function SearchPalette({
  initialQuery = "",
}: {
  initialQuery?: string;
}) {
  const open = useStore((s) => s.searchOpen);
  return open ? <SearchDialog initialQuery={initialQuery} /> : null;
}

function go(target: PaletteTarget) {
  switch (target.type) {
    case "chat":
      void openChat(target.cwd, target.id);
      break;
    case "page":
      navigate(target.page);
      break;
    case "action":
      runAction(target.action);
      break;
    case "setting":
      useStore.setState({
        settingsCategory: target.category,
        settingsFocus: target.setting,
      });
      navigate("settings");
      break;
    case "message":
      useStore.setState({
        jump: {
          sessionId: target.sessionId,
          entryId: target.entryId,
          nonce: Date.now(),
        },
      });
      void openChat(target.cwd, target.sessionId);
      break;
  }
}

function Highlight({ text, positions }: { text: string; positions: number[] }) {
  if (!positions.length) return text;
  const marked = new Set(positions);
  const parts: { text: string; mark: boolean; at: number }[] = [];
  for (let i = 0; i < text.length; i++) {
    const mark = marked.has(i);
    const last = parts[parts.length - 1];
    if (last && last.mark === mark) last.text += text[i];
    else parts.push({ text: text[i], mark, at: i });
  }
  return parts.map((part) =>
    part.mark ? (
      <mark key={part.at} className="search-match">
        {part.text}
      </mark>
    ) : (
      <Fragment key={part.at}>{part.text}</Fragment>
    ),
  );
}

function SearchDialog({ initialQuery }: { initialQuery: string }) {
  const t = useT();
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const listId = useId();
  const [query, setQuery] = useState(initialQuery);
  const [active, setActive] = useState(0);
  const [content, setContent] = useState<{
    query: string;
    hits: ConversationHit[];
    indexing: boolean;
  }>({ query: "", hits: [], indexing: false });
  const sources = useStore(
    useShallow((s) => ({
      sessions: s.sessions,
      deleting: s.deletingSessions,
      generalCwd: s.bootstrap.generalCwd,
      projects: s.bootstrap.projects,
      projectFlags: s.bootstrap.desktop.projects,
      keybindings: s.settings.keybindings,
    })),
  );
  const items = useMemo(() => paletteItems(t, sources), [t, sources]);
  const trimmed = query.trim();
  const results = useMemo(
    () => [
      ...rankItems(items, trimmed),
      ...(content.query === trimmed && trimmed
        ? messageItems(content.hits, searchTerms(trimmed), sources.sessions)
        : []),
    ],
    [items, trimmed, content, sources.sessions],
  );
  const current = Math.min(active, results.length - 1);

  useLayoutEffect(() => {
    const previous = document.activeElement;
    dialog.current?.showModal();
    input.current?.focus();
    return () => {
      dialog.current?.close();
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus({ preventScroll: true });
    };
  }, []);

  const refreshed = useRef(false);
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const run = async () => {
      // The first request rescans session files; the index answers meanwhile.
      const refresh = !refreshed.current;
      refreshed.current = true;
      try {
        const result = await rpc.request.searchConversations({
          query: trimmed,
          refresh,
        });
        if (cancelled) return;
        setContent({ query: trimmed, ...result });
        if (result.indexing) timer = setTimeout(run, INDEXING_POLL_MS);
      } catch (error) {
        if (!cancelled) showError(error);
      }
    };
    timer = setTimeout(run, refreshed.current ? DEBOUNCE_MS : 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [trimmed]);

  useEffect(() => {
    list.current
      ?.querySelector(`[data-index="${current}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [current]);

  const close = () => useStore.setState({ searchOpen: false });
  const choose = (item: RankedItem | undefined) => {
    if (!item) return;
    close();
    go(item.target);
  };
  const optionId = (index: number) => `${listId}-${index}`;
  return (
    <dialog
      ref={dialog}
      className="search-palette"
      aria-label={t["Search everything"]}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      {/* Referenced by the palette's backdrop-filter: raises the blurred backdrop to
          full alpha so the sharp content behind the transparent window cannot leak. */}
      <svg
        className="search-palette-filter"
        aria-hidden="true"
        focusable="false"
      >
        <filter id="search-palette-solid" x="0" y="0" width="1" height="1">
          <feComponentTransfer>
            <feFuncA type="linear" slope="8" />
          </feComponentTransfer>
        </filter>
      </svg>
      <div className="search-palette-input">
        <Search size={16} aria-hidden="true" />
        <input
          ref={input}
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={current >= 0 ? optionId(current) : undefined}
          aria-label={t["Search everything"]}
          placeholder={t.searchPlaceholder}
          spellCheck={false}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || event.keyCode === 229) return;
            const count = results.length;
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              if (count)
                setActive(
                  (current + (event.key === "ArrowDown" ? 1 : count - 1)) %
                    count,
                );
            } else if (event.key === "Enter") {
              event.preventDefault();
              choose(results[current]);
            }
          }}
        />
      </div>
      <div
        ref={list}
        id={listId}
        className="search-results"
        role="listbox"
        aria-label={t.searchResults}
      >
        {results.map((item, index) => {
          const Icon = icons[item.kind];
          return (
            // biome-ignore lint/a11y/useKeyWithClickEvents: Keyboard selection is handled by the combobox input.
            <div
              key={item.key}
              id={optionId(index)}
              role="option"
              tabIndex={-1}
              data-index={index}
              data-kind={item.kind}
              aria-selected={index === current}
              className="search-option"
              onMouseDown={(event) => event.preventDefault()}
              onPointerMove={() => index !== current && setActive(index)}
              onClick={() => choose(item)}
            >
              <span
                role="img"
                className="search-kind"
                title={t.searchKind(item.kind)}
                aria-label={t.searchKind(item.kind)}
              >
                <Icon size={14} aria-hidden="true" />
              </span>
              <span className="search-title">
                <Highlight text={item.title} positions={item.positions} />
              </span>
              {item.detail && (
                <span className="search-detail">{item.detail}</span>
              )}
              {item.shortcut && (
                <kbd className="search-shortcut">{item.shortcut}</kbd>
              )}
            </div>
          );
        })}
        {!results.length && <p className="search-empty">{t.searchNoResults}</p>}
      </div>
      <div className="search-palette-footer">
        <span>
          <kbd>↑↓</kbd> {t.searchHintMove} <kbd>Enter</kbd> {t.searchHintOpen}{" "}
          <kbd>Esc</kbd> {t.searchHintClose}
        </span>
        <span role="status">{content.indexing ? t.searchIndexing : ""}</span>
      </div>
    </dialog>
  );
}
