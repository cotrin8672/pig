import {
  Check,
  CircleAlert,
  CircleStop,
  Copy,
  RefreshCw,
  Sparkles,
  Split,
} from "lucide-react";
import { useState } from "react";
import type { Message, ResponseStats } from "../shared/transcript";
import { useT } from "./i18n";
import { forkChat, regenerate } from "./rpc";
import { showError, useStore } from "./store";

function duration(ms: number) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function ResponseFooter({
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
  const [copied, setCopied] = useState(false);
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
        <strong>{status.label}</strong>
        <span>· {duration(stats.durationMs)}</span>
        {stats.tools > 0 && <span>· {t.toolCount(stats.tools)}</span>}
      </div>
      <div className="response-meta">
        <span className="chip">{stats.model}</span>
        {(stats.tokensPerSecond !== undefined || stats.totalTokens > 0) && (
          <span className="chip" title={t["Output speed · total tokens"]}>
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
          </span>
        )}
      </div>
      <div className="response-actions">
        <time dateTime={new Date(stats.endedAt).toISOString()}>
          {new Date(stats.endedAt).toLocaleTimeString(language)}
        </time>
        <button
          type="button"
          title={t["Copy response"]}
          aria-label={t["Copy response"]}
          disabled={!stats.text}
          onClick={() =>
            void navigator.clipboard.writeText(stats.text).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }, showError)
          }
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </button>
        <button
          type="button"
          title={t["Branch into new chat"]}
          aria-label={t["Branch into new chat"]}
          disabled={!entryId}
          onClick={() => {
            if (entryId) void forkChat(sessionId, entryId).catch(showError);
          }}
        >
          <Split size={14} />
        </button>
        {canRegenerate && user && userEntryId && (
          <button
            type="button"
            title={t.Regenerate}
            aria-label={t.Regenerate}
            onClick={() =>
              void regenerate(sessionId, user, userEntryId).catch(showError)
            }
          >
            <RefreshCw size={14} />
          </button>
        )}
      </div>
    </div>
  );
}
