import {
  CircleAlert,
  CircleStop,
  RefreshCw,
  Sparkles,
  Split,
} from "lucide-react";
import { memo, type ReactNode, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import type { Message, ResponseStats } from "../shared/transcript";
import { useT } from "./i18n";
import { CopyButton } from "./patterns/CopyButton";
import { Chip } from "./primitives/Chip";
import { forkChat, regenerate } from "./rpc";
import { showError, useStore } from "./store";
import { type TipContent, useTooltip } from "./Tooltip";

type T = ReturnType<typeof useT>;

/** Per-response token breakdown for the speed/total chip's Tooltip. */
export function usageTip(
  stats: ResponseStats,
  t: T,
  language: string,
): TipContent {
  const num = new Intl.NumberFormat(language);
  const rows: [string, string][] = [
    [t["Input tokens"], num.format(stats.input)],
    [t["Cache read"], num.format(stats.cacheRead)],
    [t["Cache write"], num.format(stats.cacheWrite)],
    [t["Output tokens"], num.format(stats.output)],
    [t.Requests, num.format(stats.requests)],
  ];
  if (stats.tokensPerSecond !== undefined)
    rows.push([
      t["Output speed"],
      t.tokensPerSecond(Math.round(stats.tokensPerSecond)),
    ]);
  if (stats.cost > 0)
    rows.push([t["API-equivalent cost"], `$${stats.cost.toFixed(4)}`]);
  return { tier: "rich", label: "", rows };
}

type Files = NonNullable<ResponseStats["files"]>;

function LineDelta({ added, removed }: { added: number; removed: number }) {
  return (
    <span className="response-delta">
      <span className="tool-add">+{added}</span>
      <span className="tool-del">−{removed}</span>
    </span>
  );
}

/** Per-file line counts for the changed-files chip's Tooltip. */
export function filesTip(files: Files, t: T): TipContent {
  const rows: [string, ReactNode][] = files
    .slice(0, 4)
    .map((file) => [file.path, <LineDelta key={file.path} {...file} />]);
  if (files.length > 4) rows.push([t.moreFiles(files.length - 4), ""]);
  return { tier: "rich", label: "", rows };
}

function duration(ms: number) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export const ResponseFooter = memo(function ResponseFooter({
  sessionId,
  entryId,
  userEntryId,
  stats,
  user,
  canRegenerate,
}: {
  sessionId: string;
  entryId?: string;
  userEntryId?: string;
  stats: ResponseStats;
  user?: Extract<Message, { role: "user" }>;
  canRegenerate: boolean;
}) {
  const t = useT();
  const language = useStore((s) => s.settings.language);
  const tooltip = useTooltip();
  const address = useStore(useShallow((s) => s.snapshots[sessionId]?.address));
  const ready = useStore((s) => s.snapshots[sessionId]?.ready !== false);
  const [action, setAction] = useState<"fork" | "regenerate">();
  const canBranch = !!address && ready;
  function run(kind: "fork" | "regenerate", request: () => Promise<unknown>) {
    if (action) return;
    setAction(kind);
    void request()
      .catch(showError)
      .finally(() => setAction(undefined));
  }
  const status =
    stats.stopReason === "error"
      ? { icon: <CircleAlert size={14} />, label: t.Failed }
      : stats.stopReason === "aborted"
        ? { icon: <CircleStop size={14} />, label: t.Stopped }
        : { icon: <Sparkles size={14} />, label: t.Finished };
  return (
    <div className={`response-footer ${stats.stopReason}`}>
      <div className="response-summary">
        {status.icon}
        <strong>{stats.imported ? t.historyImported : status.label}</strong>
        {!stats.imported && <span>· {duration(stats.durationMs)}</span>}
        {stats.tools > 0 && <span>· {t.toolCount(stats.tools)}</span>}
      </div>
      <div className="response-meta">
        <Chip>{stats.model}</Chip>
        {(stats.tokensPerSecond !== undefined || stats.totalTokens > 0) && (
          <Chip
            aria-description={t["Output speed · total tokens"]}
            {...tooltip(() => ({
              ...usageTip(stats, t, language),
              side: "top",
            }))}
          >
            {stats.tokensPerSecond !== undefined &&
              t.tokensPerSecond(Math.round(stats.tokensPerSecond))}
            {stats.tokensPerSecond !== undefined &&
              stats.totalTokens > 0 &&
              " · "}
            {stats.totalTokens > 0 &&
              new Intl.NumberFormat(language, {
                notation: "compact",
                maximumFractionDigits: 1,
              }).format(stats.totalTokens)}
          </Chip>
        )}
        {stats.files?.length ? (
          <Chip
            tabIndex={0}
            {...tooltip(() => ({
              ...filesTip(stats.files ?? [], t),
              side: "top",
            }))}
          >
            {t.patchFiles(stats.files.length)} ·{" "}
            <LineDelta
              added={stats.files.reduce((sum, file) => sum + file.added, 0)}
              removed={stats.files.reduce((sum, file) => sum + file.removed, 0)}
            />
          </Chip>
        ) : null}
      </div>
      <div className="response-actions">
        <time dateTime={new Date(stats.endedAt).toISOString()}>
          {new Date(stats.endedAt).toLocaleTimeString(language)}
        </time>
        <CopyButton
          label={t["Copy response"]}
          disabled={!stats.text}
          copy={() => navigator.clipboard.writeText(stats.text)}
          onError={showError}
        />
        <button
          type="button"
          aria-label={t["Branch into new chat"]}
          disabled={!entryId || !canBranch || !!action}
          onClick={() => {
            if (entryId) run("fork", () => forkChat(sessionId, entryId));
          }}
        >
          <Split size={14} />
        </button>
        {canRegenerate && user && userEntryId && (
          <button
            type="button"
            aria-label={t.Regenerate}
            disabled={!canBranch || !!action}
            onClick={() =>
              run("regenerate", () => regenerate(sessionId, user, userEntryId))
            }
          >
            <RefreshCw size={14} />
          </button>
        )}
      </div>
    </div>
  );
});
