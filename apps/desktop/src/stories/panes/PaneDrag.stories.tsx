import type { Meta, StoryObj } from "@storybook/react-vite";
import { PaneDragPreview } from "./PaneDragPreview";

const meta = {
  title: "Window/Pane Drag",
  component: PaneDragPreview,
  parameters: {
    windowPreview: true,
    docs: {
      description: {
        component:
          "paneのwinbarをつまんで移動するプレビュー。ドラッグ中は移動後のレイアウトを重ねて表示し、移動するpaneをアクセント色で示します。paneの上下左右の端にドロップするとその側に分割、中央にドロップすると入れ替え。Escでキャンセル。",
      },
    },
  },
  argTypes: { initialLayout: { control: false } },
} satisfies Meta<typeof PaneDragPreview>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Columns: Story = {
  name: "01 · 左右2分割から",
  args: { initialLayout: "columns" },
};
export const BottomSplit: Story = {
  name: "02 · 上1枚＋下2枚から",
  args: { initialLayout: "bottomSplit" },
};
export const Grid: Story = {
  name: "03 · 4分割から",
  args: { initialLayout: "grid" },
};
