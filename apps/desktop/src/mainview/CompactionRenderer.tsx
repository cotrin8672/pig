import type { ChatRenderData, ChatRendererProps } from "@pig/chat-renderers";
import { FoldVertical, LoaderCircle } from "lucide-react";
import type { TranscriptRecord } from "../shared/transcript";
import { ChatContent } from "./ChatContent";
import { useT } from "./i18n";
import { Markdown } from "./MessageContent";
import { LazyDetails } from "./patterns/LazyDetails";
import "./transcript-notices.css";

export function BuiltinCompaction({ data }: ChatRendererProps<"compaction">) {
  const t = useT();
  const Icon = data.active ? LoaderCircle : FoldVertical;
  return (
    <section
      className="compaction-card"
      data-active={data.active ? "" : undefined}
      aria-label={data.active ? t.compactionWorking : t.compactionDone}
    >
      <div className="compaction-heading" role="status">
        <Icon size={16} aria-hidden="true" />
        <strong>{data.active ? t.compactionWorking : t.compactionDone}</strong>
      </div>
      <p>
        {data.active
          ? t.compactionDescription
          : data.tokensBefore !== undefined
            ? t.compactionTokens(data.tokensBefore.toLocaleString())
            : t.compactionFinished}
      </p>
      {!data.active && data.summary && (
        <LazyDetails summary={t.compactionSummary} name="compaction">
          {() => (
            <div className="prose">
              <Markdown text={data.summary ?? ""} />
            </div>
          )}
        </LazyDetails>
      )}
    </section>
  );
}

export function Compaction(data: ChatRenderData["compaction"]) {
  return (
    <ChatContent kind="compaction" data={data} builtin={BuiltinCompaction} />
  );
}

export function CompactionRecord({ record }: { record: TranscriptRecord }) {
  const data = record.kind === "session-entry" ? record.data : undefined;
  const entry = data && typeof data === "object" ? data : {};
  return (
    <Compaction
      active={false}
      summary={
        "summary" in entry && typeof entry.summary === "string"
          ? entry.summary
          : undefined
      }
      tokensBefore={
        "tokensBefore" in entry &&
        typeof entry.tokensBefore === "number" &&
        Number.isFinite(entry.tokensBefore) &&
        entry.tokensBefore >= 0
          ? entry.tokensBefore
          : undefined
      }
    />
  );
}
