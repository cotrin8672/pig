import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  type IndicatorLayout,
  IndicatorStage,
  type IndicatorVariant,
} from "./SessionIndicators";

type Args = {
  layout: IndicatorLayout;
  attention: boolean;
  expanded: boolean;
};

const meta = {
  title: "Window/Session Indicators",
  parameters: {
    windowPreview: true,
    docs: {
      description: {
        component:
          "ペインごとに、セッションを通した情報（`ctx.ui.setStatus` / `setWidget`、バックグラウンドタスク、サブエージェント）を表示する領域のデザイン案。左の大きいペインは情報が多いセッション、右上は少ないセッション、右下は空のセッション。中身の行は全案で共通で、入口と置き場所だけが違う。送信・実セッションへの接続は未実装。",
      },
    },
  },
  args: { layout: "three", attention: false, expanded: false },
  argTypes: {
    layout: {
      control: "inline-radio",
      options: ["three", "single", "grid"],
      description: "ペインの分割（3枚 / 1枚 / 4分割）",
    },
    attention: {
      control: "boolean",
      description: "タスクの失敗とサブエージェントの入力待ちを発生させる",
    },
    expanded: {
      control: "boolean",
      description: "左上ペインのバックグラウンド一覧を開いた状態にする",
    },
  },
} satisfies Meta<Args>;
export default meta;
type Story = StoryObj<Args>;

const proposal = (
  variant: IndicatorVariant,
  name: string,
  fit: string,
): Story => ({
  name,
  parameters: { docs: { description: { story: fit } } },
  render: (args) => (
    <IndicatorStage variant={variant} title={name} fit={fit} {...args} />
  ),
});

export const Dock = proposal(
  "dock",
  "A · Composer上のドック",
  "Composerの真上に1行の帯を重ねる。左にsetStatusの文字列、右にウィジェット・タスク・サブエージェントの件数。押すと帯の上に展開する。現行SessionPanelの延長で、会話の幅に揃う。情報が出た瞬間に帯の分だけComposerの上端が上がる。",
);
export const Rail = proposal(
  "rail",
  "B · 右端のアイコンレール",
  "ペイン右端、閉じるボタンの下に縦のアイコン列。件数と状態点だけを常に出し、内容はペイン内のフライアウト。幅も高さも取らず、4分割の小さいペインでも崩れない。ステータス文字列は開かないと読めない。",
);
export const Island = proposal(
  "island",
  "C · 上端のアイランド",
  "ペイン上端に浮くピル。いちばん急ぐ1件（失敗 > 入力待ち > 実行中 > ステータス）だけを文字で出し、押すと全セクションを下に展開。会話の先頭にだけピル分の余白を取り、スクロールすると本文の上に重なる。",
);
export const Inline = proposal(
  "inline",
  "D · Composerツールバーに統合",
  "Composerのツールバー、モデル名の左に件数ボタンとステータス文字列を並べる。追加の領域はゼロで、モデルPickerと同じくComposerの上にPopoverを開く。狭いペインではステータス文字列を省き件数だけになる。",
);
export const Inspector = proposal(
  "inspector",
  "E · 右側インスペクタ ＋ レール",
  "幅760px以上のペインでは右に折り畳めるインスペクタ列（272px）を置き、全セクションを常に表示する。狭いペインや折り畳み時はBのレールになる。タスクやエージェントを監視しながら作業する用途向け。",
);
