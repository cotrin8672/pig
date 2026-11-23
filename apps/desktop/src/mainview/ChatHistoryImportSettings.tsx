import { ChevronDown, FileJson, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type {
  ChatHistoryItem,
  ChatHistoryPreview,
  LocalHistorySource,
} from "../shared/chat-history-import";
import { useT } from "./i18n";
import { Checkbox } from "./primitives/Checkbox";
import { ProviderIcon } from "./primitives/ProviderIcon";
import { Select } from "./primitives/Select";
import { TextField } from "./primitives/TextField";
import { rpc } from "./rpc";
import { showError, showNotice, useStore } from "./store";
import "./chat-history-import.css";

type Source = LocalHistorySource | "file";
type Sort = "newest" | "oldest" | "title";
const sources: Source[] = ["codex", "claude-code", "file"];
const ALL = "";

const sourceIcon = (source: Source) =>
  source === "file" ? (
    <FileJson size={16} aria-hidden="true" />
  ) : (
    <ProviderIcon
      provider={source === "codex" ? "openai" : "anthropic"}
      size={18}
    />
  );
const projectName = (path: string) =>
  path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;

function discard() {
  rpc.send.discardChatHistory();
  useStore.setState({ chatHistoryFile: undefined });
}
function load(source: Source) {
  const requestId = crypto.randomUUID();
  if (source === "file") {
    useStore.setState({ chatHistoryFile: { requestId } });
    rpc.send.chooseChatHistory({ requestId });
  } else {
    useStore.setState({ chatHistoryFile: { requestId, source } });
    rpc.send.listChatHistory({ requestId, source });
  }
}

/** Settings → Chat import: source tabs over the import list. */
export function ChatHistoryImport() {
  const t = useT();
  const file = useStore((s) => s.chatHistoryFile);
  const busy = useStore((s) => s.chatHistoryImporting);
  const [tab, setTab] = useState<Source>(
    file?.preview ? (file.preview.source ?? "file") : "codex",
  );
  useEffect(() => {
    // Showing the page lists the first app right away; an existing list is kept.
    if (!useStore.getState().chatHistoryFile) load("codex");
  }, []);
  const select = (source: Source) => {
    if (busy || source === tab) return;
    setTab(source);
    discard();
    if (source !== "file") load(source);
  };
  const pending = !!file && !file.preview && !file.error;
  return (
    <div className="history-import" data-setting="chat-history-import">
      <p className="history-intro">{t.historyImportDescription}</p>
      <nav
        className="segmented-control history-tabs"
        aria-label={t.historySources}
      >
        {sources.map((source) => (
          <button
            key={source}
            type="button"
            aria-pressed={tab === source}
            disabled={busy && tab !== source}
            onClick={() => select(source)}
          >
            {sourceIcon(source)}
            <span>
              {source === "codex"
                ? "Codex"
                : source === "claude-code"
                  ? "Claude Code"
                  : t.historySourceFile}
            </span>
          </button>
        ))}
      </nav>
      <section
        className="settings-card history-panel"
        aria-label={t.historyImportTitle}
      >
        {file?.preview ? (
          <ImportList key={file.preview.id} preview={file.preview} />
        ) : (
          <div className="history-pane-state" role="status">
            {pending ? (
              <p>
                {tab === "file"
                  ? t.historySourceFileOpening
                  : t.historySourceReading}
              </p>
            ) : tab === "file" ? (
              <>
                <FileJson size={28} aria-hidden="true" />
                <p>{t.historySourceFileHint}</p>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => load("file")}
                >
                  {t.historyChooseFile}
                </button>
              </>
            ) : (
              <>
                <p>
                  {file?.error ? `${t.historyLoadFailed} ${file.error}` : ""}
                </p>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => load(tab)}
                >
                  {t.historyRetry}
                </button>
              </>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function ImportList({ preview }: { preview: ChatHistoryPreview }) {
  const t = useT();
  const language = useStore((s) => s.settings.language);
  const busy = useStore((s) => s.chatHistoryImporting);
  const total = preview.conversations.length;
  const [query, setQuery] = useState("");
  const [project, setProject] = useState(ALL);
  const [sort, setSort] = useState<Sort>("newest");
  // A parsed export is usually imported whole; an app history is picked from.
  const [selected, setSelected] = useState<Set<string>>(
    () =>
      new Set(
        preview.kind === "file"
          ? preview.conversations.map((item) => item.id)
          : [],
      ),
  );

  const projectCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of preview.conversations)
      if (item.workspace)
        counts.set(item.workspace, (counts.get(item.workspace) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1]);
  }, [preview]);
  const items = useMemo(() => {
    const needle = query.toLocaleLowerCase().trim();
    const visible = preview.conversations.filter(
      (item) =>
        (project === ALL || item.workspace === project) &&
        item.title.toLocaleLowerCase().includes(needle),
    );
    const order: Record<
      Sort,
      (a: ChatHistoryItem, b: ChatHistoryItem) => number
    > = {
      newest: (a, b) => b.modified - a.modified,
      oldest: (a, b) => a.modified - b.modified,
      title: (a, b) => a.title.localeCompare(b.title, language),
    };
    return visible.sort(order[sort]);
  }, [preview, query, project, sort, language]);
  const visibleSelected = items.filter((item) => selected.has(item.id)).length;
  const format = useMemo(
    () =>
      new Intl.DateTimeFormat(language, {
        dateStyle: "medium",
        timeStyle: "short",
      }),
    [language],
  );
  const count = selected.size;

  function toggle(ids: string[], on: boolean) {
    setSelected((old) => {
      const next = new Set(old);
      for (const id of ids) on ? next.add(id) : next.delete(id);
      return next;
    });
  }
  async function submit() {
    if (busy || !count) return;
    useStore.setState({ chatHistoryImporting: true });
    try {
      const result = await rpc.request.importChatHistory({
        previewId: preview.id,
        ids: count === total ? null : [...selected],
      });
      // Success is visible in the list itself; only failures need a notice.
      if (result.failed)
        showNotice({
          level: "error",
          message: [
            t.historyImportFailed(result.failed),
            ...(result.errors ?? [])
              .slice(0, 3)
              .map(({ title, message }) => `${title}: ${message}`),
          ].join("\n"),
        });
      else setSelected(new Set());
    } catch (error) {
      showError(error);
    } finally {
      useStore.setState({ chatHistoryImporting: false });
    }
  }

  return (
    <>
      <div className="history-toolbar">
        <label className="history-search">
          <Search size={16} aria-hidden="true" />
          <TextField
            aria-label={t.historyImportSearch}
            placeholder={t.historyImportSearch}
            value={query}
            disabled={busy}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        {projectCounts.length > 0 && (
          <div className="settings-select history-filter">
            <Select
              aria-label={t.historyProject}
              value={project}
              disabled={busy}
              onChange={(event) => setProject(event.target.value)}
            >
              <option value={ALL}>{t.historyAllProjects(total)}</option>
              {projectCounts.map(([path, n]) => (
                <option key={path} value={path}>
                  {projectName(path)} ({n})
                </option>
              ))}
            </Select>
            <ChevronDown size={14} aria-hidden="true" />
          </div>
        )}
        <div className="settings-select history-sort">
          <Select
            aria-label={t.historySort}
            value={sort}
            disabled={busy}
            onChange={(event) => setSort(event.target.value as Sort)}
          >
            <option value="newest">{t.historySortNewest}</option>
            <option value="oldest">{t.historySortOldest}</option>
            <option value="title">{t.historySortTitle}</option>
          </Select>
          <ChevronDown size={14} aria-hidden="true" />
        </div>
      </div>

      <label className="history-listhead">
        <Checkbox
          mixed={visibleSelected > 0 && visibleSelected < items.length}
          checked={items.length > 0 && visibleSelected === items.length}
          disabled={busy || !items.length}
          onChange={(event) =>
            toggle(
              items.map((item) => item.id),
              event.target.checked,
            )
          }
        />
        <span>{t.historySelectShown(items.length)}</span>
        <span className="history-count" role="status">
          {t.historyImportCount(count, total)}
        </span>
      </label>

      <fieldset
        className="history-list"
        aria-label={t.historyImportTitle}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: The scroll region needs keyboard paging.
        tabIndex={0}
        disabled={busy}
      >
        {items.map((item) => (
          <label key={item.id} className="history-item">
            <Checkbox
              aria-label={item.title}
              checked={selected.has(item.id)}
              onChange={(event) => toggle([item.id], event.target.checked)}
            />
            <span className="history-item-body">
              <span
                className="history-item-title"
                aria-description={item.title}
              >
                {item.title}
              </span>
              <span className="history-item-detail">
                {[
                  item.workspace && projectName(item.workspace),
                  item.messageCount !== undefined &&
                    t.historyImportMessages(item.messageCount),
                  ...item.warnings.map(
                    (warning) => t.historyImportWarnings[warning],
                  ),
                ]
                  .filter(Boolean)
                  .join(" · ") || "\u00a0"}
              </span>
            </span>
            {item.modified > 0 && (
              <time
                className="history-item-date"
                dateTime={new Date(item.modified).toISOString()}
              >
                {format.format(item.modified)}
              </time>
            )}
          </label>
        ))}
        {!items.length && <p className="history-empty">{t.searchNoResults}</p>}
      </fieldset>

      <div className="history-footer">
        <span className="history-note">
          {preview.kind === "local"
            ? t.historyImportToProjects
            : t.historyImportToGeneral}{" "}
          {t.historyImportLimits}
          {preview.rejected > 0 &&
            ` ${t.historyImportRejected(preview.rejected)}`}
        </span>
        <button
          type="button"
          className="primary"
          disabled={busy || !count}
          onClick={() => {
            void submit();
          }}
        >
          {busy ? t.historyImportBusy : t.historyImportSubmit(count)}
        </button>
      </div>
    </>
  );
}
