import type { Meta, StoryObj } from "@storybook/react-vite";
import { PanePreview } from "./PanePreview";

const meta = {
  title: "Window/Panes",
  component: PanePreview,
  parameters: {
    windowPreview: true,
    docs: {
      description: {
        component:
          "Dividerだけで区切るpaneプレビュー。分割ボタンはフォーカス中のpaneが対象です。同じ方向への追加分割はそのグループを均等配置し、別方向なら対象paneだけを分割します。Dividerのドラッグ・矢印キーでサイズ調整できます。サイドバーはセッション選択、各paneは拡大・閉じるに対応。最大4つのサンプルセッションで、送信・実セッションへの接続・永続化は未実装です。",
      },
    },
  },
  argTypes: {
    initialLayout: { control: false },
    sidebar: { control: false },
  },
} satisfies Meta<typeof PanePreview>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Single: Story = {
  name: "01 · 分割前 / 操作ボタン",
  args: { initialLayout: "single" },
};
export const TopBottom: Story = {
  name: "02 · 上下2分割 / 1:1",
  args: { initialLayout: "stacked" },
};
export const MainAndSub: Story = {
  name: "03 · 上下2分割 / 2:1",
  args: { initialLayout: "weighted" },
};
export const ThreeRows: Story = {
  name: "04 · 上下3分割",
  args: { initialLayout: "triple" },
};
export const SideBySide: Story = {
  name: "05 · 左右2分割",
  args: { initialLayout: "columns" },
};
export const BottomSplit: Story = {
  name: "06 · 上1枚＋下2枚",
  args: { initialLayout: "bottomSplit" },
};
export const FourPanes: Story = {
  name: "07 · 4分割",
  args: { initialLayout: "grid" },
};
export const WithoutSidebar: Story = {
  name: "08 · サイドバーを閉じた上下分割",
  args: { initialLayout: "stacked", sidebar: false },
};
