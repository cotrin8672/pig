import { Check, CircleAlert, Link2, Trash2 } from "lucide-react";
import { type ReactNode, useState } from "react";
import { IndicatorDot } from "./IndicatorDot";
import { ConfirmButton } from "./patterns/ConfirmButton";
import { CopyButton } from "./patterns/CopyButton";
import { ErrorAlert } from "./patterns/ErrorAlert";
import { Button } from "./primitives/Button";
import { Spinner } from "./primitives/Spinner";
import { TextField } from "./primitives/TextField";
import "./pairing-dialogs.css";

function SpinnerCheck({ done }: { done: boolean }) {
  return done ? <Check size={16} /> : <Spinner />;
}

const clock = (seconds: number) => {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${Math.floor(seconds / 3600)}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}`;
};

export const CONNECT_STEPS = [
  "コードを確認",
  "接続先のPCを探す",
  "暗号化した接続を確立",
  "このPCを登録",
];
export type ConnectState = "input" | "connecting" | "connected" | "error";

export function RemoveButton({
  name,
  onRemove,
}: {
  name: string;
  onRemove: () => void;
}) {
  return (
    <ConfirmButton
      className="mac-remove"
      aria-description={name}
      onConfirm={onRemove}
    >
      <Trash2 size={13} aria-hidden="true" />
      削除
    </ConfirmButton>
  );
}

/** Connected / offline line shared by every layout. */
export function Presence({
  online,
  children,
}: {
  online: boolean;
  children?: ReactNode;
}) {
  return (
    <>
      {online && <IndicatorDot state="completed" />}
      {online ? "接続中" : "オフライン"}
      {children}
    </>
  );
}

function InviteCodeCopy({
  text,
  onCopy,
}: {
  text: string;
  onCopy: () => void;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="mac-copy">
      {failed && (
        <span className="mac-row-detail">選択してコピーしてください</span>
      )}
      <CopyButton
        variant="icon"
        label="招待コードをコピー"
        copiedLabel="コピー済み"
        persistent
        copy={async () => {
          await navigator.clipboard.writeText(text);
          setFailed(false);
          onCopy();
        }}
        onError={() => setFailed(true)}
      />
    </span>
  );
}

export type InviteStage = "idle" | "waiting" | "paired";
/** Adopted invite sheet: the status line changes, the code row stays put. */
export function InviteBody({
  code,
  peer,
  left,
  stage,
  onCopy,
}: {
  code: string;
  peer?: string;
  left: number;
  stage: InviteStage;
  onCopy: () => void;
}) {
  const paired = stage === "paired";
  return (
    <>
      <div className="mac-invite-status" role="status">
        <span className="mac-invite-glyph" aria-hidden="true">
          {stage === "idle" ? (
            <Link2 size={16} />
          ) : (
            <SpinnerCheck done={paired} />
          )}
        </span>
        <strong>
          {paired
            ? `${peer} を追加しました`
            : stage === "waiting"
              ? "追加するPCを待っています…"
              : "招待の準備ができました"}
        </strong>
      </div>
      <p className="mac-note">
        別のPCの「PCに接続…」に招待コードを貼り付けます。
      </p>
      <div className="mac-invite-token">
        <div className="mac-invite-token-head">
          <strong>招待コード</strong>
          <span className="mac-row-detail" role="timer">
            {paired ? "使用済み" : `残り ${clock(left)} · 1回限り`}
          </span>
        </div>
        <div className="mac-invite-code-line">
          {paired ? (
            <span className="mac-row-detail">この招待はもう使えません</span>
          ) : (
            <>
              <code>{code}</code>
              <InviteCodeCopy key={code} text={code} onCopy={onCopy} />
            </>
          )}
        </div>
      </div>
      <p className="mac-note">
        追加したPCはチャットを開き、このPCでモデルやツールを実行できます。
      </p>
    </>
  );
}

interface Connect {
  value: string;
  step: number;
  state: ConnectState;
  setValue: (code: string) => void;
  host?: string;
  errorText?: string;
}

function connectStatus(c: Connect) {
  if (c.state === "connected") return `${c.host || "相手のPC"} に接続しました`;
  if (c.state === "connecting") return `${CONNECT_STEPS[c.step]}…`;
  if (c.state === "error") return `${CONNECT_STEPS[c.step]}に失敗`;
  return "招待コードを入力してください";
}

function ConnectProgressLine({ c }: { c: Connect }) {
  return (
    <div className="mac-connect-status" data-state={c.state}>
      <span aria-hidden="true">
        {c.state === "error" ? (
          <CircleAlert size={16} />
        ) : c.state === "input" ? (
          <Link2 size={16} />
        ) : (
          <SpinnerCheck done={c.state === "connected"} />
        )}
      </span>
      {c.state === "connected" ? "すべての手順が完了" : connectStatus(c)}
    </div>
  );
}

function ConnectSegmentedProgress({ c }: { c: Connect }) {
  return (
    <div className="mac-connect-progress">
      <div className="mac-connect-progress-heading">
        <ConnectProgressLine c={c} />
        <span className="mac-connect-count">
          {Math.max(0, c.step)} / {CONNECT_STEPS.length} 完了
        </span>
      </div>
      <div className="mac-connect-segments" aria-hidden="true">
        {CONNECT_STEPS.map((label, index) => (
          <span
            key={label}
            data-done={index < c.step || undefined}
            data-current={index === c.step ? c.state : undefined}
          />
        ))}
      </div>
    </div>
  );
}

/** Code input with the segmented connection progress. */
export function ConnectBody({ c, submit }: { c: Connect; submit: () => void }) {
  const locked = c.state === "connecting" || c.state === "connected";
  return (
    <>
      <form
        className="input-row"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <TextField
          className="mac-code-input"
          aria-label="招待コード"
          placeholder="pig-pair:1:…"
          autoComplete="off"
          spellCheck={false}
          value={c.value}
          disabled={locked}
          aria-invalid={c.state === "error" || undefined}
          onChange={(event) => c.setValue(event.target.value)}
        />
        <Button
          type="submit"
          variant="primary"
          disabled={!c.value.trim() || locked}
        >
          接続
        </Button>
      </form>
      <ConnectSegmentedProgress c={c} />
      <span
        className={c.state === "connected" ? "mac-row-detail" : "sr-only"}
        role="status"
      >
        {locked ? connectStatus(c) : ""}
      </span>
      {c.state === "error" && (
        <ErrorAlert>
          {c.errorText ??
            "このコードは使用済みか期限切れです。接続先のPCで新しいコードを作ってください。"}
        </ErrorAlert>
      )}
    </>
  );
}
