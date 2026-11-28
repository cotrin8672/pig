import type { Meta, StoryObj } from "@storybook/react-vite";
import { ShellCommandTips, type ShellPhase } from "./ShellCommandTip";
import { type Backdrop, TooltipShapes, TooltipStage } from "./TooltipPreview";
import { TooltipSwitchLab } from "./TooltipSwitchLab";

type Args = { backdrop: Backdrop };

const meta = {
  title: "Components/Tooltip",
  parameters: {
    windowPreview: true,
    themeColor: "#7DBFBD",
    neutralWallpaper: true,
    docs: {
      description: {
        component:
          "アプリ共通のTooltip。テーマ #7DBFBD をウィンドウ全体に適用し、壁紙は同テーマの単色に固定。面は `mainview/tooltip.css` の `ui-tooltip`（アクセント4%＋白み12%、背景alpha50%、枠16%、`blur(4px)`）。採用した面を通常のTooltip・使用量の詳細・統計グラフに共通適用する。中身の型（1行／キー付き／見出し＋説明／値の一覧）とキーキャップは用途ごとに選ぶ。`backdrop` で下に敷く内容を切り替えて透過を確認できる。動作：top layer、500ms遅延（直後の隣は即時、隙間のない行は滑って追従）、`:focus-visible` でも表示、Escape・スクロール・クリックで閉じる。",
      },
    },
  },
  args: { backdrop: "text" },
  argTypes: {
    backdrop: {
      control: "inline-radio",
      options: ["text", "code", "image", "plain"],
      description: "Tooltipの下に敷く内容（本文・コード・画像・なし）",
    },
  },
} satisfies Meta<Args>;
export default meta;
type Story = StoryObj<Args>;

export const LighterSurface: Story = {
  name: "色比較：以前／薄め／ごく薄め／採用",
  parameters: {
    docs: {
      description: {
        story:
          "テーマカラー #7DBFBD を背景にも適用した比較。以前のアクセント28%／薄め14%／ごく薄め4%と、採用した「ごく薄め＋白み12%」の4案。採用案は本番の共通Tooltipをそのまま表示する。面の透明度50%・ぼかし・文字色は同じ。backdropで背景を切り替えて確認できる。",
      },
    },
  },
  render: ({ backdrop }) => (
    <div className="tt-page tt-surface-compare">
      <section className="tt-surface-original">
        <h2 className="tt-matrix-head">以前：背景のアクセント28%・枠40%</h2>
        <TooltipShapes backdrop={backdrop} />
      </section>
      <section className="tt-surface-light">
        <h2 className="tt-matrix-head">薄め：背景のアクセント14%・枠24%</h2>
        <TooltipShapes backdrop={backdrop} />
      </section>
      <section className="tt-surface-faint">
        <h2 className="tt-matrix-head">ごく薄め：背景のアクセント4%・枠16%</h2>
        <TooltipShapes backdrop={backdrop} />
      </section>
      <section>
        <h2 className="tt-matrix-head">採用：ごく薄め＋白み12%・枠16%</h2>
        <TooltipShapes backdrop={backdrop} />
      </section>
    </div>
  ),
};

export const RowSwitch: Story = {
  name: "提案：隙間のない行の切り替え",
  parameters: {
    docs: {
      description: {
        story:
          "サイドバーのセッション一覧のように行が隙間なく並ぶとき、行から行へ移る際のTooltipの動きを比較する模擬実装。本番にはC（スライド追従）を採用した。初回は500ms後に開き、閉じて400ms以内は即時（本番と同じ）。",
      },
    },
  },
  render: () => (
    <div className="tt-page">
      <TooltipSwitchLab />
    </div>
  ),
};

export const ShellCommand: StoryObj<{ phase: ShellPhase }> = {
  name: "シェルコマンドの全文",
  parameters: {
    docs: {
      description: {
        story:
          "見切れたBash/PowerShellの見出しにホバーすると、全文と状態・実行時間・シェル・タイムアウト・出力行数を出す（本番の `shellTip`）。ここでは実物の見出しの下に固定表示する。コマンドは等幅・折り返し・8行まで。",
      },
    },
  },
  args: { phase: "error" },
  argTypes: {
    phase: {
      control: "inline-radio",
      options: ["running", "done", "error"],
    },
  },
  render: ({ phase }) => (
    <div className="tt-page">
      <ShellCommandTips phase={phase} />
    </div>
  ),
};

export const InApp: Story = {
  name: "画面内でホバー",
  render: ({ backdrop }) => (
    <div className="tt-page">
      <TooltipStage backdrop={backdrop} />
    </div>
  ),
};
