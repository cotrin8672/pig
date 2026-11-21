import type { ChatRenderData } from "@pig/chat-renderers";
import { Check, MessageCircleQuestion } from "lucide-react";
import { useState } from "react";
import { UserMessage } from "../../mainview/MessageContent";
import { ScheduledPromptRecord } from "../../mainview/ScheduledPrompt";
import { scheduledMarker } from "../../mainview/scheduled-prompt-model";
import type { TranscriptRecord } from "../../shared/transcript";
import {
  askUser,
  firedMarker,
  scheduledPrompt,
  subagentDoneMarker,
  subagentStartMarker,
} from "./agent-data";
import type { Proposal } from "./kit";
import "../../mainview/sdk-ui.css";
import "./agent.css";

const none = () => null;
/* ---------- scheduled_prompt (shipped) ---------- */

const custom = (record: TranscriptRecord): ChatRenderData["custom"] => ({
  id: record.id,
  customType: "scheduled_prompt",
  content: [],
  details: undefined,
  raw: record,
});

/** A prompt sent by a job: the fire marker is folded into its bubble. */
export const ScheduledBubble = () => (
  <div className="response-turn">
    <article className="message user">
      <UserMessage
        message={{
          role: "user",
          timestamp: Date.UTC(2026, 10, 21, 0, 0),
          content: scheduledPrompt.prompt,
        }}
        sessionId="preview"
        disabled={false}
        entryId="scheduled-user"
        scheduled={scheduledMarker(firedMarker)?.jobName}
      />
    </article>
  </div>
);

/** A job with a model: its prompt runs in a separate session, then reports. */
export const ScheduledSeparateSession = () => (
  <>
    <ScheduledPromptRecord
      DefaultRenderer={none}
      data={custom(subagentStartMarker)}
    />
    <ScheduledPromptRecord
      DefaultRenderer={none}
      data={custom(subagentDoneMarker)}
    />
  </>
);

/* ---------- ask_user while waiting for the answer (proposal) ---------- */

type AskOption = { title: string; description?: string };
const ask = askUser.tool.call.arguments as {
  question: string;
  context: string;
  options: AskOption[];
};

/** Today: ask_user's TUI runs inside the terminal dialog (described, not mocked). */
export const AskPendingDefault = () => (
  <div className="ag-note">
    <p>
      現在の pig は <code>ctx.ui.custom()</code> を TerminalUIHost で描くため、
      ask_user はターミナルダイアログ内の
      TUI（矢印キーで選択）として表示されます。
    </p>
  </div>
);

/** A native question dialog: number keys, one comment field, clear Send. */
function QuestionDialog() {
  const [picked, setPicked] = useState<string | null>(
    ask.options[0]?.title ?? null,
  );
  const [note, setNote] = useState("");
  return (
    <div
      className="sdk-request ag-question"
      role="dialog"
      aria-label={ask.question}
    >
      <header>
        <MessageCircleQuestion size={16} />
        <h2>{ask.question}</h2>
      </header>
      <p className="ag-context">{ask.context}</p>
      <div className="ag-choices" role="radiogroup">
        {ask.options.map((option, i) => (
          // biome-ignore lint/a11y/useSemanticElements: Story-only mock of a roving radio row.
          <button
            type="button"
            role="radio"
            aria-checked={picked === option.title}
            key={option.title}
            onClick={() => setPicked(option.title)}
          >
            <kbd>{i + 1}</kbd>
            <span>
              <strong>{option.title}</strong>
              {option.description && <small>{option.description}</small>}
            </span>
            {picked === option.title && <Check size={14} />}
          </button>
        ))}
      </div>
      <textarea
        aria-label="補足（任意）"
        placeholder="補足や別の答え（任意）"
        rows={2}
        value={note}
        onChange={(event) => setNote(event.target.value)}
      />
      <div className="dialog-actions">
        <button type="button">スキップ</button>
        <button type="button" className="primary">
          回答する
        </button>
      </div>
    </div>
  );
}

export const askPendingProposals = {
  Dialog: {
    title: "ネイティブ質問ダイアログ",
    fit: "回答待ちの間。TUIではなく入力要求ダイアログ（差し色の枠）で、選択肢は数字キーで選べる行、補足は1つの入力欄。選択と自由記述を同じ画面で済ませる。",
    View: QuestionDialog,
  },
} satisfies Record<string, Proposal<object>>;
