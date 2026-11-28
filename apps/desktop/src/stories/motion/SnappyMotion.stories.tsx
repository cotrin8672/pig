import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  Check,
  ChevronRight,
  ListEnd,
  MessageSquare,
  SendHorizontal,
  Settings,
} from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { CopyButton } from "../../mainview/patterns/CopyButton";
import { Button } from "../../mainview/primitives/Button";
import { Checkbox } from "../../mainview/primitives/Checkbox";
import { IconButton } from "../../mainview/primitives/IconButton";
import { SegmentedControl } from "../../mainview/primitives/SegmentedControl";
import { Select } from "../../mainview/primitives/Select";
import { Spinner } from "../../mainview/primitives/Spinner";
import { Switch } from "../../mainview/primitives/Switch";
import "./snappy-motion.css";
import { SpinnerCheck } from "./SpinnerCheck";

function Demo({
  title,
  rule,
  children,
}: {
  title: string;
  rule: string;
  children: ReactNode;
}) {
  return (
    <section className="snappy-card">
      <h3>{title}</h3>
      <p>{rule}</p>
      <div className="snappy-demo">{children}</div>
    </section>
  );
}

function Press() {
  return (
    <Demo
      title="押下"
      rule="ホバーで1px浮き、押すと150msで96%へ押し込まれる（影も縮む）。離すと浮いた位置へ戻る。拡縮中も文字を1枚の画像として扱い、にじみやピクつきを防ぐ。"
    >
      <Button variant="primary">送信</Button>
      <Button>キャンセル</Button>
      <IconButton aria-label="設定">
        <Settings size={16} />
      </IconButton>
    </Demo>
  );
}

function Hover() {
  return (
    <Demo
      title="ホバー"
      rule="入るときは即時、出るときは100msで消す。持ち上げ・拡大はしない。"
    >
      <ul className="snappy-rows">
        {["設計メモ", "バグ調査", "リリース準備", "依存の更新"].map((name) => (
          <li key={name}>
            <button type="button" className="snappy-row">
              <MessageSquare size={14} />
              {name}
            </button>
          </li>
        ))}
      </ul>
    </Demo>
  );
}

function Disclosure() {
  const [open, setOpen] = useState(true);
  return (
    <Demo
      title="開閉"
      rule="見出しの位置は固定。中身の高さを120msで伸縮し、シェブロンも同じ時間で回す。連打しても途中から戻る。"
    >
      <div className="snappy-rows">
        <button
          type="button"
          className="snappy-row"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <ChevronRight size={14} className="snappy-chevron" />
          pig
        </button>
        <div
          className="snappy-collapse"
          data-open={open || undefined}
          inert={!open}
        >
          <ul className="snappy-rows snappy-indent">
            <li className="snappy-row">モーション調査</li>
            <li className="snappy-row">スクロールバー修正</li>
          </ul>
        </div>
        <span className="snappy-row snappy-muted">次のプロジェクト</span>
      </div>
    </Demo>
  );
}

function Dropdown() {
  return (
    <Demo
      title="ドロップダウン"
      rule="本番のSelect。開くときは140msで透明度と拡大（0.97→1）、閉じるときは80msの透明度だけ。"
    >
      <Select aria-label="モデル" defaultValue="Opus">
        <option>Opus</option>
        <option>Sonnet</option>
        <option>Haiku</option>
      </Select>
    </Demo>
  );
}

const tabs = [
  { value: "general", label: "一般" },
  { value: "models", label: "モデル" },
  { value: "keys", label: "ショートカット" },
] as const;
type Tab = (typeof tabs)[number]["value"];
const tabIndex = (tab: Tab) => tabs.findIndex((t) => t.value === tab);

/** SegmentedControl whose selection highlight slides between options. The highlight
 * is one layer positioned from the pressed option, so it moves instead of reappearing. */
function Segments<T extends string>(props: {
  "aria-label": string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure the DOM whenever the selection changes.
  useLayoutEffect(() => {
    const field =
      root.current?.querySelector<HTMLElement>(".segmented-control");
    const place = () => {
      const on = field?.querySelector<HTMLElement>('[aria-pressed="true"]');
      if (!field || !on) return;
      field.style.setProperty("--seg-x", `${on.offsetLeft}px`);
      field.style.setProperty("--seg-w", `${on.offsetWidth}px`);
    };
    place();
    // Enable the slide only after the first placement, so it never animates in.
    requestAnimationFrame(() => field?.setAttribute("data-slide", ""));
    const observer = new ResizeObserver(place);
    if (field) observer.observe(field);
    return () => observer.disconnect();
  }, [props.value]);
  return (
    <div className="snappy-segments" ref={root}>
      <SegmentedControl {...props} />
    </div>
  );
}

function Tabs() {
  const [tab, setTab] = useState<Tab>("general");
  return (
    <Demo
      title="画面切替"
      rule="選択中のハイライトが140msで次の項目へ滑る。中身は動かさず100msでフェードイン。"
    >
      <div className="snappy-column">
        <Segments
          aria-label="設定の分類"
          options={tabs}
          value={tab}
          onChange={setTab}
        />
        <div key={tab} className="snappy-page">
          {tabs[tabIndex(tab)].label}の設定がここに並びます。
        </div>
      </div>
    </Demo>
  );
}

function Toggles() {
  const [on, setOn] = useState(true);
  const [checked, setChecked] = useState(false);
  return (
    <Demo title="切替" rule="スイッチのつまみ・色は100ms。チェックは即時。">
      <label className="snappy-inline">
        <Switch checked={on} onChange={(e) => setOn(e.target.checked)} />
        自動承認
      </label>
      <label className="snappy-inline">
        <Checkbox
          checked={checked}
          onChange={(e) => setChecked(e.target.checked)}
        />
        通知を受け取る
      </label>
    </Demo>
  );
}

function CopyFeedback() {
  return (
    <Demo
      title="完了の合図"
      rule="本番のCopyButton。成功時だけチェックを120msで拡大する。戻すときは動かさない。"
    >
      <CopyButton
        variant="icon"
        label="コピー"
        copiedLabel="コピーしました"
        copy={async () => {}}
        onError={() => {}}
      />
    </Demo>
  );
}

function SpinnerToCheck() {
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  function run() {
    clearTimeout(timer.current);
    setState("busy");
    timer.current = setTimeout(() => setState("done"), 1200);
  }
  return (
    <Demo
      title="処理中→完了"
      rule="スピナーの弧がその角度のまま閉じて輪になり、中にチェックを描く（各150ms）。別のアイコンに差し替えない。"
    >
      <div className="snappy-column">
        <Button onClick={run}>ツールを実行</Button>
        <div className="snappy-tool-row">
          {state !== "idle" && <SpinnerCheck done={state === "done"} />}
          <span>
            {state === "done"
              ? "read src/app.ts"
              : state === "busy"
                ? "read src/app.ts…"
                : "未実行"}
          </span>
        </div>
      </div>
    </Demo>
  );
}

type Msg = { id: number; text: string; acked?: boolean };
type Queued = Msg & { mode: "steer" | "queue" };

function OptimisticSend() {
  const [draft, setDraft] = useState("");
  const [log, setLog] = useState<Msg[]>([]);
  const [queue, setQueue] = useState<Queued[]>([]);
  const [running, setRunning] = useState(false);
  const [mode, setMode] = useState<Queued["mode"]>("steer");
  const deliver = useCallback((m: Queued) => {
    setQueue((q) => q.filter((x) => x.id !== m.id));
    setLog((l) => [...l, { id: m.id, text: m.text, acked: true }]);
  }, []);
  // Steering lands at the agent's next step, simulated as a fixed delay.
  useEffect(() => {
    const steer = queue.find((m) => m.mode === "steer");
    if (!steer) return;
    const id = setTimeout(() => deliver(steer), running ? 900 : 0);
    return () => clearTimeout(id);
  }, [queue, running, deliver]);
  // A follow-up starts the next run as soon as the current one ends.
  useEffect(() => {
    const next = queue.find((m) => m.mode === "queue");
    if (running || !next || queue.some((m) => m.mode === "steer")) return;
    deliver(next);
    setRunning(true);
  }, [queue, running, deliver]);
  function send() {
    const text = draft.trim();
    if (!text) return;
    const id = Date.now();
    setDraft("");
    if (running) return setQueue((q) => [...q, { id, text, mode }]);
    setLog((l) => [...l, { id, text }]);
    setRunning(true);
    // Stands in for the agent acknowledging the prompt.
    setTimeout(
      () =>
        setLog((l) => l.map((m) => (m.id === id ? { ...m, acked: true } : m))),
      600,
    );
  }
  return (
    <Demo
      title="楽観的な送信"
      rule="待機中: 会話へ即追加。実行中のSteer: 入力欄の上に即表示し、次のステップで会話へ移す。Queue: 実行が終わるまで入力欄の上で待ち、終わると次の依頼として会話へ移す。"
    >
      <div className="snappy-column">
        <ul className="snappy-messages">
          {log.map((m) => (
            <li key={m.id} className="snappy-message">
              {m.text}
              {!m.acked && <small>送信中</small>}
            </li>
          ))}
          {running && (
            <li key="working" className="snappy-working">
              <Spinner size={12} /> 作業中…
            </li>
          )}
        </ul>
        {queue.length > 0 && (
          <ol className="snappy-queue">
            {queue.map((m) => (
              <li key={m.id} className="snappy-queued" data-mode={m.mode}>
                {m.mode === "steer" ? (
                  <SendHorizontal
                    size={12}
                    aria-label="次のステップで割り込み"
                  />
                ) : (
                  <ListEnd size={12} aria-label="実行完了後に送信" />
                )}
                {m.text}
              </li>
            ))}
          </ol>
        )}
        <form
          className="snappy-inline"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="メッセージ"
          />
          <Button variant="primary" type="submit">
            {running ? (mode === "steer" ? "Steer" : "Queue") : "送信"}
          </Button>
        </form>
        <div className="snappy-inline">
          <label className="snappy-inline">
            <Switch
              checked={running}
              onChange={(e) => setRunning(e.target.checked)}
            />
            実行中
          </label>
          <Segments
            aria-label="実行中の送信"
            options={[
              { value: "steer", label: "Steer" },
              { value: "queue", label: "Queue" },
            ]}
            value={mode}
            onChange={setMode}
          />
        </div>
      </div>
    </Demo>
  );
}

function DelayedSpinner() {
  const [runs, setRuns] = useState<"idle" | "busy" | "done">("idle");
  function run(ms: number) {
    setRuns("busy");
    setTimeout(() => setRuns("done"), ms);
  }
  const status = (delayed: boolean) =>
    runs === "busy" ? (
      <span className={delayed ? "snappy-late" : undefined}>
        <Spinner label="処理中" />
      </span>
    ) : runs === "done" ? (
      <Check size={14} />
    ) : null;
  return (
    <Demo
      title="スピナーの遅延表示（保留）"
      rule="400ms以内に終わる処理では何も出さない。超えたら120msでフェードイン。左右で同じ処理を比較。"
    >
      <div className="snappy-column">
        <div className="snappy-inline">
          <Button onClick={() => run(150)}>速い処理 (150ms)</Button>
          <Button onClick={() => run(1500)}>遅い処理 (1.5秒)</Button>
        </div>
        <div className="snappy-compare">
          <span>即時に表示</span>
          <span className="snappy-slot">{status(false)}</span>
          <span>400ms後に表示</span>
          <span className="snappy-slot">{status(true)}</span>
        </div>
      </div>
    </Demo>
  );
}

const reply =
  "了解しました。まず該当するCSSを洗い出し、閉じる動きを短くしてから、押下の反応を即時にします。変更後に実描画で確認します。次に、ストリーミングの塊の大きさを実測して、平滑化が必要な範囲を決めます。";

/** Bursty chunks like a real provider: mostly small, sometimes a large burst. */
function chunks() {
  const out: { at: number; size: number }[] = [];
  let at = 0;
  for (let sent = 0; sent < reply.length; ) {
    at += 30 + Math.random() * 170;
    const size =
      Math.random() < 0.15 ? 30 + Math.random() * 40 : 2 + Math.random() * 12;
    sent += Math.round(size);
    out.push({ at, size: Math.min(sent, reply.length) });
  }
  return out;
}

function Streaming() {
  const [received, setReceived] = useState(0);
  const [shown, setShown] = useState(0);
  const target = useRef(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  // Drain the backlog proportionally each frame: big bursts spread over ~100ms,
  // small ones appear at once, so smoothing never lags far behind.
  useEffect(() => {
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = now - last;
      last = now;
      setShown((s) => {
        const backlog = target.current - s;
        return backlog <= 0
          ? s
          : s + Math.max(1, Math.ceil(backlog * Math.min(1, dt / 100)));
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);
  function start() {
    timers.current.forEach(clearTimeout);
    target.current = 0;
    setReceived(0);
    setShown(0);
    timers.current = chunks().map(({ at, size }) =>
      setTimeout(() => {
        target.current = size;
        setReceived(size);
      }, at),
    );
  }
  return (
    <Demo
      title="ストリーミング出力"
      rule="実際は不規則な塊で届く。左は届いたまま、右は塊を約100msかけて流し込む。フェード・カーソル点滅・スムーズスクロールは付けない。"
    >
      <div className="snappy-column">
        <Button onClick={start}>返答を流す</Button>
        <div className="snappy-stream-compare">
          <div>
            <small>届いたまま</small>
            <p className="snappy-stream">{reply.slice(0, received)}</p>
          </div>
          <div>
            <small>平滑化</small>
            <p className="snappy-stream">{reply.slice(0, shown)}</p>
          </div>
        </div>
      </div>
    </Demo>
  );
}

function SnappyMotion() {
  return (
    <div className="snappy-motion">
      <header>
        <strong>軽快プロファイル</strong>
        <p className="snappy-lead">
          反応は即時、押した・動いたという物理的な手応えを短く返す。イージングはease-outのみで、
          開閉はtransitionなので途中で割り込める。
        </p>
      </header>
      <div className="snappy-grid">
        <Press />
        <Hover />
        <Disclosure />
        <Dropdown />
        <Tabs />
        <Toggles />
        <CopyFeedback />
        <SpinnerToCheck />
        <OptimisticSend />
        <Streaming />
        <DelayedSpinner />
      </div>
    </div>
  );
}

const meta = {
  title: "Prototypes/Snappy Motion",
  component: SnappyMotion,
  parameters: { windowPreview: true },
} satisfies Meta<typeof SnappyMotion>;
export default meta;

export const Playground: StoryObj<typeof meta> = { name: "軽快" };
