import type { Meta, StoryObj } from "@storybook/react-vite";
import { type Backdrop, TooltipShapes, TooltipStage } from "./TooltipPreview";
import { TooltipSwitchLab } from "./TooltipSwitchLab";

type Args = { backdrop: Backdrop };

const meta = {
  title: "Components/Tooltip",
  parameters: {
    windowPreview: true,
    docs: {
      description: {
        component:
          "アプリ共通のTooltip。面は `mainview/tooltip.css` の `ui-tooltip`（アクセント色を混ぜた50%の面＋`blur(4px)`）。中身の型（1行／キー付き／見出し＋説明／値の一覧）とキーキャップは用途ごとに選ぶ。`backdrop` で下に敷く内容を切り替えて透過を確認できる。動作：top layer、500ms遅延（直後の隣は即時、隙間のない行は滑って追従）、`:focus-visible` でも表示、Escape・スクロール・クリックで閉じる。",
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

export const Shapes: Story = {
  name: "中身の型",
  render: ({ backdrop }) => (
    <div className="tt-page">
      <TooltipShapes backdrop={backdrop} />
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

export const InApp: Story = {
  name: "画面内でホバー",
  render: ({ backdrop }) => (
    <div className="tt-page">
      <TooltipStage backdrop={backdrop} />
    </div>
  ),
};
