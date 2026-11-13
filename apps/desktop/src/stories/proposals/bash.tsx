import { Check, ChevronRight, LoaderCircle, X } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { CodeText, TerminalOutput } from "../../mainview/HighlightedCode";
import type { Phase, Proposal, ToolProps } from "./kit";
import { shell } from "./tools";
import "./bash.css";

/*
 * Mini-terminal proposals. All keep the same two parts — the command and its
 * log — and differ only in how the surface sits on the acrylic window:
 * every layer is an alpha tint, never an opaque panel.
 */

/** Wall-clock seconds while the command runs, so a stalled command is visible. */
function useElapsed(active: boolean) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!active) return;
    const started = Date.now();
    setSeconds(0);
    const timer = setInterval(
      () => setSeconds((Date.now() - started) / 1000),
      100,
    );
    return () => clearInterval(timer);
  }, [active]);
  return seconds;
}

function useTerm({ tool, phase }: ToolProps) {
  const result = shell(tool);
  const elapsed = useElapsed(phase === "running");
  const [open, setOpen] = useState(true);
  return {
    ...result,
    prompt: tool.call.name === "powershell" ? "PS>" : "$",
    language: tool.call.name,
    time:
      phase === "running"
        ? `${elapsed.toFixed(1)}s`
        : result.seconds !== undefined
          ? `${result.seconds}s`
          : undefined,
    exit:
      phase === "running"
        ? undefined
        : result.exitCode === undefined
          ? "中断"
          : `exit ${result.exitCode}`,
    open,
    toggle: () => setOpen((value) => !value),
  };
}
type Term = ReturnType<typeof useTerm>;

function StatusGlyph({ phase }: { phase: Phase }) {
  if (phase === "running")
    return <LoaderCircle size={12} className="spinner" aria-label="実行中" />;
  return phase === "done" ? (
    <Check size={12} aria-label="成功" />
  ) : (
    <X size={12} aria-label="失敗" />
  );
}

/** The log keeps the shared 8-line height; longer output scrolls inside. */
function Log({
  term,
  phase,
  className = "",
  children,
}: {
  term: Term;
  phase: Phase;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <pre className={`mt-log ${className}`}>
      {children}
      {term.raw ? (
        <TerminalOutput text={term.raw} />
      ) : (
        phase !== "running" && <span className="mt-empty">(出力なし)</span>
      )}
      {phase === "running" && (
        <>
          {term.raw && "\n"}
          <span className="mt-cursor" aria-hidden="true" />
        </>
      )}
    </pre>
  );
}

/** The command row doubles as the open/close control, like the built-in card. */
function CommandRow({
  term,
  className,
  children,
}: {
  term: Term;
  className: string;
  children?: ReactNode;
}) {
  return (
    <button
      type="button"
      className={className}
      aria-expanded={term.open}
      onClick={term.toggle}
    >
      <span className="mt-prompt">{term.prompt}</span>
      <code className="mt-command" title={term.command}>
        <CodeText text={term.command} language={term.language} />
      </code>
      {children}
      <ChevronRight
        size={12}
        className={`mt-chevron${term.open ? " pp-open" : ""}`}
      />
    </button>
  );
}

/* ---------------- 1. frosted ---------------- */

function Frosted(props: ToolProps) {
  const term = useTerm(props);
  const { phase } = props;
  return (
    <div className={`mt-term mt-frosted mt-${phase}`}>
      <CommandRow term={term} className="mt-head">
        <span className="mt-meta">
          <i className="mt-dot" aria-hidden="true" />
          {term.exit && phase === "error" ? term.exit : term.time}
        </span>
      </CommandRow>
      {term.open && <Log term={term} phase={phase} />}
    </div>
  );
}

/* ---------------- 2. tinted ---------------- */

function Tinted(props: ToolProps) {
  const term = useTerm(props);
  const { phase } = props;
  return (
    <div className={`mt-term mt-tinted mt-${phase}`}>
      <CommandRow term={term} className="mt-head">
        <span className="mt-meta">
          {term.time}
          {term.exit && <span className="mt-pill">{term.exit}</span>}
        </span>
      </CommandRow>
      {term.open && <Log term={term} phase={phase} />}
    </div>
  );
}

/* ---------------- 3. well ---------------- */

function Well(props: ToolProps) {
  const term = useTerm(props);
  const { phase } = props;
  return (
    <div className={`mt-well mt-${phase}`}>
      <CommandRow term={term} className="mt-well-head">
        <span className="mt-meta">
          <StatusGlyph phase={phase} />
          {phase === "error" ? term.exit : term.time}
        </span>
      </CommandRow>
      {term.open && (
        <div className="mt-well-frame">
          <Log term={term} phase={phase} />
        </div>
      )}
    </div>
  );
}

/* ---------------- 4. mini window ---------------- */

function MiniWindow(props: ToolProps) {
  const term = useTerm(props);
  const { tool, phase } = props;
  return (
    <div className={`mt-term mt-window mt-${phase}`}>
      <div className="mt-titlebar">
        <span className="mt-shell">{tool.call.name}</span>
        <span className="mt-meta">
          {term.time}
          <span className="mt-pill">
            <StatusGlyph phase={phase} />
            {phase === "running" ? "running" : term.exit}
          </span>
        </span>
      </div>
      <CommandRow term={term} className="mt-head mt-window-command" />
      {term.open && <Log term={term} phase={phase} />}
    </div>
  );
}

/* ---------------- 5. rail ---------------- */

function Rail(props: ToolProps) {
  const term = useTerm(props);
  const { phase } = props;
  return (
    <div className={`mt-rail mt-${phase}`}>
      <CommandRow term={term} className="mt-rail-head">
        <span className="mt-meta">
          {phase === "error" ? term.exit : term.time}
        </span>
      </CommandRow>
      {term.open && <Log term={term} phase={phase} className="mt-rail-log" />}
    </div>
  );
}

/* ---------------- 6. one pane ---------------- */

function OnePane(props: ToolProps) {
  const term = useTerm(props);
  const { phase } = props;
  return (
    <div className={`mt-term mt-onepane mt-${phase}`}>
      <Log term={term} phase={phase}>
        <span className="mt-onepane-line">
          <span className="mt-prompt">{term.prompt} </span>
          <CodeText text={term.command} language={term.language} />
          <span className="mt-onepane-meta">
            {term.time}
            {term.exit && <span className="mt-pill">{term.exit}</span>}
          </span>
        </span>
        {"\n"}
      </Log>
    </div>
  );
}

export const bashProposals = {
  Frosted: {
    title: "すりガラス",
    fit: "背景を淡くぼかした一枚のガラス。上端のハイライトと細い区切り線だけで、コマンドとログを分ける。状態は右上の小さな点で示す。",
    View: Frosted,
  },
  Tinted: {
    title: "状態色のガラス",
    fit: "ガラスそのものを成功・失敗・実行中の色でごく薄く染める。枠に色を付けるより面で伝わり、背景の色とも混ざる。",
    View: Tinted,
  },
  Well: {
    title: "くぼんだログ",
    fit: "外枠を持たず、コマンドは会話の面に置く。ログだけを一段くぼんだ暗い層にして、背景の透過をいちばん多く残す。",
    View: Well,
  },
  MiniWindow: {
    title: "ミニウィンドウ",
    fit: "シェル名と状態を細いタイトルバーに分けた小さな端末窓。タイトルバー・コマンド・ログを同じガラスの濃淡で重ねる。",
    View: MiniWindow,
  },
  Rail: {
    title: "左レール",
    fit: "箱を作らず、左端の状態色のレールでまとめる。背景は右へ向かって消えるグラデーションで、透過した背景に溶け込む。",
    View: Rail,
  },
  OnePane: {
    title: "プロンプト一体型",
    fit: "本物の端末と同じく、コマンドをログの1行目として同じ面に書く。見出しの帯がないぶん、最も小さな端末に見える。",
    View: OnePane,
  },
} satisfies Record<string, Proposal<ToolProps>>;
