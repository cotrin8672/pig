import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  Check,
  CircleAlert,
  ClipboardPaste,
  Copy,
  KeyRound,
  Laptop,
  Link2,
  Monitor,
  X,
} from "lucide-react";
import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { ConfirmButton } from "../../mainview/patterns/ConfirmButton";
import { SettingsCard } from "../../mainview/patterns/SettingsCard";
import { Button } from "../../mainview/primitives/Button";
import { IconButton } from "../../mainview/primitives/IconButton";
import { Keycap } from "../../mainview/primitives/Keycap";
import { TextField } from "../../mainview/primitives/TextField";
import { previewDefaults } from "../current-ui/fixtures";
import { PreviewTheme } from "../current-ui/Previews";
import { SpinnerCheck } from "../motion/SpinnerCheck";
import {
  ConnectBody,
  type ConnectState,
  CopyButton,
  clock,
  Grow,
  HOST_NAME,
  INVITE,
  InviteBody,
  ListRow,
  NEW_DEVICE,
  Tile,
} from "./remote-pairing-parts";
import "./pairing-dialogs.css";

const SHORT = "K7QF29XM";
const TOTAL = 12 * 60 * 60;
const PAIR_MS = 2500;
const STEP_MS = 450;
const HOST_ID = "8f3c…a91e";

/** Invite demo: copying starts the other PC's (simulated) redemption. */
function useInvite() {
  const [expires] = useState(() => Date.now() + TOTAL * 1000);
  const [now, setNow] = useState(Date.now());
  const [stage, setStage] = useState<"idle" | "waiting" | "paired">("idle");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(id);
      clearTimeout(timer.current);
    };
  }, []);
  return {
    left: Math.max(0, Math.round((expires - now) / 1000)),
    stage,
    paired: stage === "paired",
    copy() {
      clearTimeout(timer.current);
      setStage("waiting");
      timer.current = setTimeout(() => setStage("paired"), PAIR_MS);
    },
    reset() {
      clearTimeout(timer.current);
      setStage("idle");
    },
  };
}
type Invite = ReturnType<typeof useInvite>;

const CONNECT_STEPS = [
  "コードを確認",
  "接続先のPCを探す",
  "暗号化した接続を確立",
  "このPCを登録",
];
/** Connect demo: a code starting with pig-pair:1: walks through each step. */
function useConnect(initial = "") {
  const [value, setValue] = useState(initial);
  const [step, setStep] = useState(-1);
  const [failed, setFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval>>(undefined);
  useEffect(() => () => clearInterval(timer.current), []);
  const done = step >= CONNECT_STEPS.length;
  const state: ConnectState = failed
    ? "error"
    : done
      ? "connected"
      : step >= 0
        ? "connecting"
        : "input";
  return {
    value,
    step,
    state,
    setValue(next: string) {
      setValue(next);
      setFailed(false);
    },
    submit(code = value) {
      clearInterval(timer.current);
      setValue(code);
      if (!code.trim().startsWith("pig-pair:1:")) {
        setStep(0);
        setFailed(true);
        return;
      }
      setFailed(false);
      setStep(0);
      timer.current = setInterval(
        () =>
          setStep((index) => {
            if (index + 1 >= CONNECT_STEPS.length) clearInterval(timer.current);
            return index + 1;
          }),
        STEP_MS,
      );
    },
    reset() {
      clearInterval(timer.current);
      setValue("");
      setStep(-1);
      setFailed(false);
    },
  };
}
type Connect = ReturnType<typeof useConnect>;

/** A sheet frozen open in place, so variants sit side by side. */
function Panel({
  title,
  onClose,
  footer,
  className,
  children,
}: {
  title: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <dialog
      open
      className={`oauth-dialog mac-sheet pd-panel ${className ?? ""}`}
      aria-label={typeof title === "string" ? title : undefined}
    >
      <div className="dialog-heading">
        <h2>{title}</h2>
        <IconButton aria-label="閉じる（最初から）" onClick={onClose}>
          <X size={15} aria-hidden="true" />
        </IconButton>
      </div>
      {children}
      {footer && <div className="dialog-actions">{footer}</div>}
    </dialog>
  );
}

function Waiting({ d }: { d: Invite }) {
  return (
    <div className="mac-status" role="status">
      {d.stage === "idle" ? (
        <Copy size={14} aria-hidden="true" />
      ) : (
        <SpinnerCheck done={d.paired} />
      )}
      {d.paired
        ? `${NEW_DEVICE} を追加しました`
        : d.stage === "waiting"
          ? "追加するPCでの貼り付けを待っています…"
          : "コピーすると待ち受けを始めます"}
    </div>
  );
}
const inviteFooter = (d: Invite) =>
  d.paired ? (
    <Button variant="primary" onClick={d.reset}>
      完了
    </Button>
  ) : (
    <ConfirmButton onConfirm={d.reset}>コードを取り消す</ConfirmButton>
  );

// ---- PCを追加（招待コード）

function InviteBaseline() {
  const d = useInvite();
  return (
    <Panel title="PCを追加" onClose={d.reset} footer={inviteFooter(d)}>
      <InviteBody left={d.left} paired={d.paired} onCopy={d.copy} />
    </Panel>
  );
}

function InviteShortCode() {
  const d = useInvite();
  const [long, setLong] = useState(false);
  return (
    <Panel title="PCを追加" onClose={d.reset} footer={inviteFooter(d)}>
      <p className="pd-lead">
        追加するPCで「PCに接続…」を開き、このコードを入力します。
      </p>
      <div className="pd-short" role="img" aria-label={`コード ${SHORT}`}>
        {[...SHORT].map((char, index) => (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: characters may repeat.
            key={index}
            style={{ "--i": index } as CSSProperties}
            data-gap={index === 3 || undefined}
          >
            {char}
          </span>
        ))}
      </div>
      <div className="pd-row">
        <span className="mac-row-detail" role="timer">
          残り {clock(d.left)} · 1回限り
        </span>
        <CopyButton text={SHORT} onCopy={d.copy} />
      </div>
      <Waiting d={d} />
      <button
        type="button"
        className="pd-link"
        aria-expanded={long}
        onClick={() => setLong(!long)}
      >
        {long
          ? "長い招待文字列を隠す"
          : "長い招待文字列を表示（ネットワーク外で渡すとき）"}
      </button>
      <Grow leaving={!long}>
        <code className="mac-code">{INVITE}</code>
      </Grow>
    </Panel>
  );
}

const STEPS = ["コピー", "相手のPCで貼り付け", "完了"];
function InviteStepper() {
  const d = useInvite();
  const current = d.paired ? 2 : d.stage === "waiting" ? 1 : 0;
  return (
    <Panel title="PCを追加" onClose={d.reset}>
      <ol
        className="pd-stepper"
        style={{ "--progress": current / (STEPS.length - 1) } as CSSProperties}
      >
        {STEPS.map((label, index) => (
          <li
            key={label}
            data-state={
              index < current
                ? "done"
                : index === current
                  ? "active"
                  : undefined
            }
          >
            <span className="pd-stepper-dot">
              {index < current || d.paired ? (
                <Check size={12} aria-hidden="true" />
              ) : (
                index + 1
              )}
            </span>
            {label}
          </li>
        ))}
      </ol>
      <div key={current} className="pd-step-body">
        {current === 0 && (
          <>
            <code className="mac-code">{INVITE}</code>
            <div className="pd-row">
              <span className="mac-row-detail">
                残り {clock(d.left)} · 1回限り
              </span>
              <CopyButton text={INVITE} onCopy={d.copy} />
            </div>
          </>
        )}
        {current === 1 && (
          <>
            <div className="pd-big-status">
              <SpinnerCheck done={false} />
              <span>
                追加するPCの pig で<strong>「Pairing → PCに接続…」</strong>
                を開き、貼り付けてください。
              </span>
            </div>
            <button type="button" className="pd-link" onClick={d.copy}>
              もう一度コピーする
            </button>
          </>
        )}
        {current === 2 && (
          <div className="pd-done">
            <span className="pd-done-mark">
              <Check size={26} aria-hidden="true" />
            </span>
            <strong>{NEW_DEVICE} を追加しました</strong>
            <span className="mac-row-detail">
              このPCのProjectとチャットを開けるようになりました
            </span>
            <Button variant="primary" onClick={d.reset}>
              完了
            </Button>
          </div>
        )}
      </div>
    </Panel>
  );
}

function InviteRing() {
  const d = useInvite();
  const r = 52;
  const length = 2 * Math.PI * r;
  return (
    <Panel title="PCを追加" onClose={d.reset} footer={inviteFooter(d)}>
      <div className="pd-ring" data-paired={d.paired || undefined}>
        <svg viewBox="0 0 120 120" width="132" height="132" aria-hidden="true">
          <circle className="pd-ring-track" cx="60" cy="60" r={r} />
          <circle
            className="pd-ring-left"
            cx="60"
            cy="60"
            r={r}
            strokeDasharray={length}
            strokeDashoffset={d.paired ? 0 : length * (1 - d.left / TOTAL)}
          />
        </svg>
        <span className="pd-ring-center">
          {d.paired ? (
            <Check
              key="ok"
              size={34}
              className="snappy-pop"
              aria-hidden="true"
            />
          ) : (
            <>
              <KeyRound size={18} aria-hidden="true" />
              <span role="timer">{clock(d.left)}</span>
              <small>で失効</small>
            </>
          )}
        </span>
      </div>
      <div className="pd-pill">
        <code>{INVITE}</code>
        <CopyButton text={INVITE} onCopy={d.copy} />
      </div>
      <Waiting d={d} />
    </Panel>
  );
}

function InviteDevices() {
  const d = useInvite();
  return (
    <Panel title="PCを追加" onClose={d.reset} footer={inviteFooter(d)}>
      <div className="pd-devices" data-state={d.stage}>
        <span className="pd-device">
          <Tile size="large">
            <Laptop size={22} aria-hidden="true" />
          </Tile>
          このPC
        </span>
        <span className="pd-link-line" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span className="pd-device pd-device-new">
          <Tile size="large" tone="neutral">
            <Laptop size={22} aria-hidden="true" />
          </Tile>
          {d.paired ? NEW_DEVICE : "追加するPC"}
        </span>
      </div>
      <ol className="mac-steps">
        <li>コードをコピーして、追加するPCに渡す</li>
        <li>追加するPCの「PCに接続…」に貼り付ける</li>
      </ol>
      <div className="pd-pill">
        <code>{INVITE}</code>
        <CopyButton text={INVITE} onCopy={d.copy} />
      </div>
      <Waiting d={d} />
    </Panel>
  );
}

function InviteTicket() {
  const d = useInvite();
  return (
    <Panel title="PCを追加" onClose={d.reset} footer={inviteFooter(d)}>
      <div className="pd-ticket" data-paired={d.paired || undefined}>
        <div className="pd-ticket-head">
          <span className="pd-mono">INVITE · pig-pair/1</span>
          <Link2 size={14} aria-hidden="true" />
        </div>
        <dl className="pd-ticket-fields">
          <div>
            <dt>発行元</dt>
            <dd>DESKTOP-GUMMY</dd>
          </div>
          <div>
            <dt>有効期限</dt>
            <dd role="timer">残り {clock(d.left)}</dd>
          </div>
          <div>
            <dt>使用回数</dt>
            <dd>1回</dd>
          </div>
        </dl>
        <div className="pd-perf" aria-hidden="true" />
        <div className="pd-ticket-stub">
          <code>{INVITE}</code>
          <CopyButton text={INVITE} onCopy={d.copy} />
        </div>
        {d.paired && (
          <span className="pd-stamp" aria-hidden="true">
            使用済み
          </span>
        )}
      </div>
      <Waiting d={d} />
    </Panel>
  );
}

function TermLine({ i, children }: { i: number; children: ReactNode }) {
  return (
    <div className="pd-term-line" style={{ "--i": i } as CSSProperties}>
      {children}
    </div>
  );
}

function InviteTerminal() {
  const d = useInvite();
  const [copied, setCopied] = useState(false);
  async function copy() {
    d.copy();
    setCopied(
      await navigator.clipboard.writeText(INVITE).then(
        () => true,
        () => false,
      ),
    );
  }
  return (
    <Panel title="PCを追加" onClose={d.reset} className="pd-term-panel">
      {/* biome-ignore lint/a11y/noStaticElementInteractions: the keyboard shortcut mirrors the copy button. */}
      <div
        className="pd-term"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: focus target for the C shortcut.
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key.toLowerCase() === "c") void copy();
        }}
      >
        <TermLine i={0}>
          <b>$</b> pig pair invite --expires 12h --uses 1
        </TermLine>
        <TermLine i={1}>
          <em>✓</em> 招待コードを発行しました（残り {clock(d.left)}）
        </TermLine>
        <TermLine i={2}>
          <span className="pd-term-code">{INVITE}</span>
        </TermLine>
        <TermLine i={3}>
          {d.stage === "idle" ? (
            <>
              <b>›</b> C でコピーし、追加するPCの「PCに接続…」に貼り付けます
            </>
          ) : (
            <>
              <b>…</b> 追加するPCでの貼り付けを待っています
            </>
          )}
        </TermLine>
        {d.paired && (
          <TermLine i={0}>
            <em>✓</em> {NEW_DEVICE} を登録しました（端末鍵 3a91…7c04）
          </TermLine>
        )}
        {!d.paired && <span className="pd-term-caret" aria-hidden="true" />}
      </div>
      <div className="pd-row">
        <span className="pd-keys">
          <Keycap>C</Keycap> {copied ? "コピー済み" : "コピー"}
          <Keycap>Esc</Keycap> 閉じる
        </span>
        <span className="pd-row-actions">
          {d.paired ? (
            <Button variant="primary" onClick={d.reset}>
              完了
            </Button>
          ) : (
            <Button variant="primary" onClick={() => void copy()}>
              <Copy size={14} aria-hidden="true" />
              コピー
            </Button>
          )}
        </span>
      </div>
    </Panel>
  );
}

function InvitePopover() {
  const d = useInvite();
  return (
    <div className="pd-anchor-stage">
      <SettingsCard className="mac-list">
        <ListRow
          icon={
            <Tile>
              <Laptop size={15} aria-hidden="true" />
            </Tile>
          }
          title="このPCを使えるPC"
          detail="研究室PC · ThinkPad X1"
        >
          <Button aria-expanded onClick={d.reset}>
            PCを追加…
          </Button>
        </ListRow>
      </SettingsCard>
      <div className="pd-bubble" role="dialog" aria-label="PCを追加">
        <span className="pd-bubble-title">
          <KeyRound size={13} aria-hidden="true" />
          招待コード
          <span className="mac-row-detail" role="timer">
            {clock(d.left)}
          </span>
        </span>
        <div className="pd-pill">
          <code>{INVITE}</code>
          <CopyButton text={INVITE} onCopy={d.copy} />
        </div>
        <Waiting d={d} />
      </div>
    </div>
  );
}

// ---- PCに接続（招待コードを貼り付け）

function ConnectBaseline() {
  const c = useConnect();
  return (
    <Panel title="PCに接続" onClose={c.reset}>
      <ConnectBody
        code={c.value}
        connect={c.state}
        setCode={c.setValue}
        submit={() => c.submit()}
      />
    </Panel>
  );
}

function ConnectError({ c }: { c: Connect }) {
  return c.state === "error" ? (
    <div className="oauth-error" role="alert">
      <CircleAlert size={16} aria-hidden="true" />
      このコードは使用済みか期限切れです。接続先のPCで新しいコードを作ってください。
    </div>
  ) : null;
}

function ConnectPasteZone() {
  const c = useConnect();
  const valid = c.value.startsWith("pig-pair:1:");
  return (
    <Panel
      title="PCに接続"
      onClose={c.reset}
      footer={
        <Button
          variant="primary"
          disabled={
            !valid || c.state === "connecting" || c.state === "connected"
          }
          onClick={() => c.submit()}
        >
          {c.state === "connected" ? "接続しました" : "接続"}
        </Button>
      }
    >
      <button
        type="button"
        className="pd-paste"
        data-filled={c.value ? "" : undefined}
        data-state={c.state}
        onPaste={(event) =>
          c.setValue(event.clipboardData.getData("text").trim())
        }
        onClick={async () => {
          const text = await navigator.clipboard.readText().catch(() => "");
          c.setValue(text.trim() || INVITE);
        }}
      >
        {c.value ? (
          <>
            {!valid ? (
              <CircleAlert size={18} aria-hidden="true" />
            ) : c.state === "input" ? (
              <KeyRound size={18} aria-hidden="true" />
            ) : c.state !== "error" ? (
              <SpinnerCheck done={c.state === "connected"} />
            ) : (
              <CircleAlert size={18} aria-hidden="true" />
            )}
            <strong>
              {valid ? `端末ID ${HOST_ID}` : "招待コードではありません"}
            </strong>
            <span className="mac-row-detail">
              {c.state === "connecting"
                ? CONNECT_STEPS[c.step]
                : c.state === "connected"
                  ? `${HOST_NAME} に接続しました`
                  : "クリックで貼り直す"}
            </span>
          </>
        ) : (
          <>
            <ClipboardPaste size={22} aria-hidden="true" />
            <strong>招待コードを貼り付け</strong>
            <span className="mac-row-detail">
              ここをクリック、または <Keycap>Ctrl</Keycap>
              <Keycap>V</Keycap>
            </span>
          </>
        )}
      </button>
      <ConnectError c={c} />
    </Panel>
  );
}

function ConnectDetected() {
  const c = useConnect(INVITE);
  const [manual, setManual] = useState(false);
  return (
    <Panel title="PCに接続" onClose={c.reset}>
      <div className="pd-detected">
        <Tile size="large" tone="neutral">
          <Monitor size={22} aria-hidden="true" />
        </Tile>
        <span>
          <span className="mac-row-detail">クリップボードの招待コード</span>
          <strong>端末ID {HOST_ID}</strong>
          <span className="mac-row-detail">残り 11:42:10 · 1回限り</span>
        </span>
      </div>
      <div className="pd-wide">
        <Button
          variant="primary"
          disabled={c.state === "connecting" || c.state === "connected"}
          onClick={() => c.submit()}
        >
          {c.state === "connecting" ? (
            <>
              <SpinnerCheck done={false} /> 接続しています…
            </>
          ) : c.state === "connected" ? (
            <>
              <Check size={14} aria-hidden="true" /> {HOST_NAME} に接続しました
            </>
          ) : (
            "このPCに接続"
          )}
        </Button>
      </div>
      <button
        type="button"
        className="pd-link"
        aria-expanded={manual}
        onClick={() => setManual(!manual)}
      >
        別のコードを入力する
      </button>
      <Grow leaving={!manual}>
        <form
          className="input-row"
          onSubmit={(event) => {
            event.preventDefault();
            c.submit();
          }}
        >
          <TextField
            className="mac-code-input"
            aria-label="招待コード"
            placeholder="pig-pair:1:…"
            value={c.value === INVITE ? "" : c.value}
            onChange={(event) => c.setValue(event.target.value)}
          />
          <Button type="submit">接続</Button>
        </form>
      </Grow>
      <ConnectError c={c} />
    </Panel>
  );
}

function ConnectTimeline() {
  const c = useConnect();
  return (
    <Panel title="PCに接続" onClose={c.reset}>
      <form
        className="input-row"
        onSubmit={(event) => {
          event.preventDefault();
          c.submit();
        }}
      >
        <TextField
          className="mac-code-input"
          aria-label="招待コード"
          placeholder="pig-pair:1:…（pig-pair:1: 以外は失敗します）"
          value={c.value}
          disabled={c.state === "connecting"}
          onChange={(event) => c.setValue(event.target.value)}
        />
        <Button
          type="submit"
          variant="primary"
          disabled={!c.value.trim() || c.state === "connecting"}
        >
          接続
        </Button>
      </form>
      <ol className="pd-timeline">
        {CONNECT_STEPS.map((label, index) => {
          const state =
            c.state === "error" && index === c.step
              ? "failed"
              : index < c.step
                ? "done"
                : index === c.step
                  ? "active"
                  : "pending";
          return (
            <li key={label} data-state={state}>
              <span className="pd-timeline-mark">
                {state === "failed" ? (
                  <CircleAlert size={16} aria-hidden="true" />
                ) : state === "pending" ? (
                  <span className="pd-timeline-dot" />
                ) : (
                  <SpinnerCheck done={state === "done"} />
                )}
              </span>
              {label}
            </li>
          );
        })}
      </ol>
      <ConnectError c={c} />
    </Panel>
  );
}

function ConnectSpotlight() {
  const c = useConnect();
  return (
    <Panel title="PCに接続" onClose={c.reset} className="pd-spot-panel">
      <form
        className="pd-spot"
        data-state={c.state}
        key={c.state === "error" ? c.value : "spot"}
        onSubmit={(event) => {
          event.preventDefault();
          c.submit();
        }}
      >
        <Link2 size={18} aria-hidden="true" />
        <input
          aria-label="招待コード"
          placeholder="招待コードを貼り付けて Enter"
          spellCheck={false}
          value={c.value}
          onChange={(event) => c.setValue(event.target.value)}
        />
        <span className="pd-spot-state">
          {c.state === "error" ? (
            <CircleAlert size={16} aria-hidden="true" />
          ) : c.state !== "input" ? (
            <SpinnerCheck done={c.state === "connected"} />
          ) : (
            <Keycap>Enter</Keycap>
          )}
        </span>
      </form>
      <p className="mac-note">
        {c.state === "connected"
          ? `${HOST_NAME} に接続しました。サイドバーに表示するProjectを選べます。`
          : c.state === "connecting"
            ? CONNECT_STEPS[c.step]
            : c.state === "error"
              ? "このコードは使用済みか期限切れです。"
              : "接続先のPCで「PCを追加…」を押すとコードが表示されます。"}
      </p>
    </Panel>
  );
}

// ---- gallery

type Variant = { name: string; note: string; View: () => ReactNode };
const inviteVariants: Variant[] = [
  {
    name: "1 · 基準",
    note: "手順・コード・残り時間・待ち受けを1枚に並べる現在の案。",
    View: InviteBaseline,
  },
  {
    name: "2 · 短いコード",
    note: "8文字の短いコードを大きく表示（Apple TV・Netflix 型）。長い文字列は折り畳み。",
    View: InviteShortCode,
  },
  {
    name: "3 · ステップ",
    note: "コピー → 相手で貼り付け → 完了 を上部の進捗で示し、段階ごとに中身を切り替える。",
    View: InviteStepper,
  },
  {
    name: "4 · タイマーリング",
    note: "12時間の残りを円で示し、登録されるとチェックに変わる。",
    View: InviteRing,
  },
  {
    name: "5 · 2台のPC",
    note: "このPCと追加するPCを点線でつなぎ、待機中は点が流れ、登録で実線になる。",
    View: InviteDevices,
  },
  {
    name: "6 · チケット",
    note: "発行元・期限・回数を券面に。登録されると「使用済み」の印が押される。",
    View: InviteTicket,
  },
  {
    name: "7 · コマンドライン",
    note: "端末の出力のように1行ずつ表示。C キーでコピー（フォーカス時）。",
    View: InviteTerminal,
  },
  {
    name: "8 · 吹き出し",
    note: "シートを出さず「PCを追加…」ボタンから小さく開く。",
    View: InvitePopover,
  },
];
const connectVariants: Variant[] = [
  { name: "1 · 基準", note: "手順と入力欄の現在の案。", View: ConnectBaseline },
  {
    name: "2 · 貼り付け面",
    note: "大きな面をクリックまたは Ctrl+V。貼った時点で接続先の端末IDを示す。",
    View: ConnectPasteZone,
  },
  {
    name: "3 · クリップボードを検出",
    note: "コピー済みのコードを見つけたら、1ボタンで接続。手入力は折り畳み。",
    View: ConnectDetected,
  },
  {
    name: "4 · 進行の見える化",
    note: "確認 → 検索 → 暗号化 → 登録 を順に完了させ、失敗した段階を示す。",
    View: ConnectTimeline,
  },
  {
    name: "5 · 1行の入力",
    note: "検索パレットのような大きな1行。Enter で接続し、失敗すると欄が揺れる。",
    View: ConnectSpotlight,
  },
];

function Gallery({ title, variants }: { title: string; variants: Variant[] }) {
  return (
    <PreviewTheme args={previewDefaults}>
      <div className="pd-gallery">
        <header>
          <h1>{title}</h1>
          <p>どの案も操作できます。× で最初の状態に戻ります。</p>
        </header>
        <div className="pd-grid">
          {variants.map(({ name, note, View }) => (
            <section key={name} className="pd-cell">
              <h2>{name}</h2>
              <p>{note}</p>
              <div className="pd-stage">
                <View />
              </div>
            </section>
          ))}
        </div>
      </div>
    </PreviewTheme>
  );
}

const meta = {
  title: "Prototypes/Remote Pairing Dialogs",
  parameters: {
    windowPreview: true,
    docs: {
      description: {
        component:
          "Remote Pairing のポップアップの案。招待コードを出す「PCを追加」と、コードを貼る「PCに接続」。" +
          "「PCを追加」はコピーすると2.5秒後に相手のPCが登録した想定で完了する。「PCに接続」は pig-pair:1: で始まるコードで成功する。",
      },
    },
  },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const Invite: Story = {
  name: "PCを追加（8案）",
  render: () => <Gallery title="PCを追加" variants={inviteVariants} />,
};
export const Connect: Story = {
  name: "PCに接続（5案）",
  render: () => <Gallery title="PCに接続" variants={connectVariants} />,
};
