import {
  ArrowUp,
  Bell,
  Copy,
  Gauge,
  GitBranch,
  type LucideIcon,
  PanelLeft,
  Paperclip,
  Puzzle,
  RefreshCw,
  Settings,
  SquarePen,
} from "lucide-react";
import {
  type TipContent,
  type TooltipAnchor,
  TooltipBody,
  TooltipLayer,
  type TooltipTier,
  tooltipClass,
  useTooltip,
} from "../../mainview/Tooltip";
import "./tooltips.css";

/** Storybook preview of the shared Tooltip (mainview/Tooltip.tsx). */
export type Backdrop = "text" | "code" | "image" | "plain";
type Anchor = TooltipAnchor & { icon: LucideIcon };

export const tierNames: Record<TooltipTier, string> = {
  label: "1行",
  shortcut: "1行（キー付き）",
  detail: "見出し＋説明",
  rich: "見出し＋値の一覧",
};
const allTiers = Object.keys(tierNames) as TooltipTier[];
export const samples: Record<TooltipTier, TipContent> = {
  label: { tier: "label", label: "拡張機能" },
  shortcut: { tier: "shortcut", label: "新しいチャット", keys: ["Ctrl", "N"] },
  detail: {
    tier: "detail",
    label: "新しいチャットに分岐",
    description: "この応答までの履歴をコピーして、新しいチャットを作る",
  },
  rich: {
    tier: "rich",
    label: "OpenAI Codex の使用量",
    rows: [
      ["5時間", "62% · 1時間12分後にリセット"],
      ["週", "18% · 4日後にリセット"],
      ["アカウント", "work@example.com"],
    ],
  },
};

const titlebar: Anchor[] = [
  {
    icon: PanelLeft,
    side: "bottom",
    ...samples.shortcut,
    label: "サイドバーを切り替え",
    keys: ["Ctrl", "B"],
  },
  {
    icon: Gauge,
    side: "bottom",
    ...samples.rich,
  },
  {
    icon: Bell,
    side: "bottom",
    tier: "detail",
    label: "通知",
    description: "未読 2件 · 最新: リロードに失敗しました",
  },
];
const rail: Anchor[] = [
  { icon: SquarePen, side: "right", ...samples.shortcut },
  { icon: Puzzle, side: "right", ...samples.label },
  {
    icon: Settings,
    side: "right",
    tier: "shortcut",
    label: "設定",
    keys: ["Ctrl", ","],
  },
];
const footer: Anchor[] = [
  {
    icon: Copy,
    side: "top",
    tier: "shortcut",
    label: "応答をコピー",
    keys: ["Ctrl", "Shift", "C"],
  },
  { icon: GitBranch, side: "top", ...samples.detail },
  { icon: RefreshCw, side: "top", tier: "label", label: "再生成" },
];
const composer: Anchor[] = [
  {
    icon: Paperclip,
    side: "top",
    tier: "detail",
    label: "ファイルを添付",
    description: "画像・テキストファイルはドラッグでも追加できる",
  },
  {
    icon: ArrowUp,
    side: "top",
    tier: "shortcut",
    label: "送信",
    keys: ["Enter"],
  },
];

/** Busy content to judge translucency and blur against. */
function BackdropFill({ backdrop }: { backdrop: Backdrop }) {
  if (backdrop === "plain") return null;
  if (backdrop === "image")
    return <div className="tt-bg tt-bg-image" aria-hidden="true" />;
  if (backdrop === "code")
    return (
      <pre className="tt-bg tt-bg-code" aria-hidden="true">
        {codeSample}
      </pre>
    );
  return (
    <p className="tt-bg tt-bg-text" aria-hidden="true">
      {textSample}
    </p>
  );
}
const textSample =
  "拡張機能のイベント処理で起きた例外は pi 側で捕まえられ、onError に渡される。デスクトップ側はそれを応答の失敗として表示するため、リロード中に拡張機能が UI に書き込むと、表示だけの処理でも応答が止まる。一時停止中の setStatus や notify は例外にせず捨てる。".repeat(
    2,
  );
const codeSample = `const live = () => {
  if (unavailable())
    throw new DOMException("Extension UI host unavailable", "AbortError");
};
setStatus: (key, text) => {
  if (unavailable()) return;
  checkText(key, 256);
  status.statuses = status.statuses.filter((e) => e.key !== key);
  publish();
},`;

/** Every content shape, statically open over the chosen backdrop. */
export function TooltipShapes({ backdrop }: { backdrop: Backdrop }) {
  return (
    <div className="tt-matrix">
      {allTiers.map((tier) => (
        <figure key={tier}>
          <figcaption className="tt-matrix-head">{tierNames[tier]}</figcaption>
          <div className="tt-cell">
            <BackdropFill backdrop={backdrop} />
            <div className={tooltipClass(tier)}>
              <TooltipBody content={samples[tier]} />
            </div>
          </div>
        </figure>
      ))}
    </div>
  );
}

/** A miniature window to hover tooltips in place. */
export function TooltipStage({ backdrop }: { backdrop: Backdrop }) {
  return (
    <TooltipLayer>
      <Stage backdrop={backdrop} />
    </TooltipLayer>
  );
}

function Stage({ backdrop }: { backdrop: Backdrop }) {
  const tooltip = useTooltip();
  const button = (anchor: Anchor, size = 15) => {
    const { icon: Icon, ...content } = anchor;
    return (
      <button
        key={anchor.label}
        type="button"
        className="tt-icon"
        aria-label={anchor.label}
        {...tooltip(content)}
      >
        <Icon size={size} />
      </button>
    );
  };
  return (
    <div className="tt-app">
      <div className="tt-titlebar">{titlebar.map((a) => button(a, 14))}</div>
      <aside className="tt-rail">{rail.map((a) => button(a))}</aside>
      <main className="tt-chat">
        <div className="tt-chat-body">
          <BackdropFill backdrop={backdrop} />
        </div>
        <div className="tt-row">{footer.map((a) => button(a, 14))}</div>
        <div className="tt-composer">
          <span className="tt-placeholder">メッセージを入力</span>
          <span className="tt-row">{composer.map((a) => button(a, 14))}</span>
        </div>
      </main>
    </div>
  );
}
