import { Check, Clock, CornerDownRight, LoaderCircle } from "lucide-react";
import type { ReactNode } from "react";
import { UserMessage } from "../../mainview/MessageContent";
import { ToolBlock } from "../../mainview/ToolBlock";
import { bash } from "./data";
import { atPhase, type Proposal } from "./kit";

/** pending: the agent is still inside a step; applied: the next step has read the message. */
export type SteerArgs = { phase?: "pending" | "applied" };
const steer =
  "どんだけ時間かけてるの。テストは greeting だけに絞って先に結果を見せて";
const step = "pnpm test --filter greeting";
const reply =
  "すみません、全体のテストを待っていました。greeting に絞って先に結果を出します。";

const Agent = ({ children }: { children: ReactNode }) => (
  <div className="response-turn">
    <article className="message assistant">{children}</article>
  </div>
);
const Bubble = () => (
  <UserMessage
    sessionId="preview"
    disabled
    message={{
      role: "user",
      timestamp: Date.UTC(2026, 10, 12, 3, 30),
      content: steer,
    }}
  />
);
const Work = ({ phase }: SteerArgs) => (
  <ToolBlock {...atPhase(bash, phase === "applied" ? "done" : "running")} />
);
const Reply = () => (
  <Agent>
    <p>{reply}</p>
  </Agent>
);

export function SteerDefault({ phase = "pending" }: SteerArgs) {
  return (
    <>
      <Agent>
        <Work phase={phase} />
      </Agent>
      <div className="response-turn">
        <article className="message user">
          <Bubble />
        </article>
        {phase === "pending" && (
          <p className="composer-hint" role="status">
            割り込み待ち · 次のステップで反映
          </p>
        )}
      </div>
      {phase === "applied" && <Reply />}
    </>
  );
}

/** The message is drawn where the agent will pick it up: right after the step in progress. */
function Insertion({ phase = "pending" }: SteerArgs) {
  return (
    <>
      <Agent>
        <Work phase={phase} />
        {phase === "pending" && (
          <div className="pp-steer-slot" role="status">
            <span className="pp-rule" />
            <small>このステップが終わったらここで読みます</small>
            <span className="pp-rule" />
          </div>
        )}
      </Agent>
      <div
        className={`response-turn${phase === "pending" ? " pp-steer-waiting" : ""}`}
      >
        <article className="message user">
          <Bubble />
        </article>
      </div>
      {phase === "applied" && <Reply />}
    </>
  );
}

/** The message carries its own read state, as in messaging apps. */
function Receipt({ phase = "pending" }: SteerArgs) {
  return (
    <>
      <Agent>
        <Work phase={phase} />
      </Agent>
      <div
        className={`response-turn${phase === "pending" ? " pp-steer-unread" : ""}`}
      >
        <article className="message user">
          <Bubble />
        </article>
        <p className="pp-steer-receipt" role="status">
          {phase === "pending" ? (
            <>
              <Clock size={12} aria-hidden="true" />
              未読 · <code>{step}</code> が終わると届きます
            </>
          ) : (
            <>
              <Check size={12} aria-hidden="true" />
              読まれました
            </>
          )}
        </p>
      </div>
      {phase === "applied" && <Reply />}
    </>
  );
}

/** Waiting is the agent's state, so the agent's live status says what it will do next. */
function AgentStatus({ phase = "pending" }: SteerArgs) {
  return (
    <>
      <Agent>
        <Work phase={phase} />
      </Agent>
      <div className="response-turn">
        <article className="message user">
          <Bubble />
        </article>
      </div>
      <Agent>
        {phase === "pending" ? (
          <p className="pp-steer-status" role="status">
            <LoaderCircle size={13} className="spinner" aria-hidden="true" />
            <span>
              <code>{step}</code> を実行中
            </span>
            <CornerDownRight size={13} aria-hidden="true" />
            <strong>終わり次第、あなたのメッセージを読みます</strong>
          </p>
        ) : (
          <>
            <p className="pp-steer-ack">
              <CornerDownRight size={12} aria-hidden="true" />「
              {steer.slice(0, 18)}…」を受けて方針を変更
            </p>
            <p>{reply}</p>
          </>
        )}
      </Agent>
    </>
  );
}

export const steerProposals = {
  Insertion: {
    title: "差し込まれる位置",
    fit: "割り込みは即座には届かず、実行中のステップの直後に読まれる。その位置を作業の流れの中に線で示し、届く前の吹き出しは薄くする。",
    View: Insertion,
  },
  Receipt: {
    title: "既読がつく吹き出し",
    fit: "知りたいのは「もう読まれたか」だけ、という場面。メッセージアプリの既読表示のように、待っている理由（実行中のステップ）と既読を吹き出しの下に出す。",
    View: Receipt,
  },
  AgentStatus: {
    title: "エージェントの状態として",
    fit: "割り込むのは作業を見守っている時。待っているのはエージェント側なので、実行中の状態行に「次にあなたのメッセージを読む」と書き、反映後は何を受けて方針を変えたかを返答の頭に残す。",
    View: AgentStatus,
  },
} satisfies Record<string, Proposal<SteerArgs>>;
