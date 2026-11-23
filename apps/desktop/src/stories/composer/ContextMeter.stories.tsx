import type { Meta, StoryObj } from "@storybook/react-vite";
import { type HoverArgs, states } from "./context-meter-fixtures";
import { ContextMeterHover } from "./ContextMeterHover";
import { ContextMeterStates } from "./ContextMeterStates";
import "../tooltips/tooltips.css";
import "./model-trigger.css";
import "./context-meter.css";

const meta = {
  title: "Chat/Composer/Context meter",
  parameters: {
    windowPreview: true,
    docs: {
      description: {
        component:
          "Composerのコンテキストリング（`mainview/ContextIndicator.tsx`）。ホバーで共通Tooltipの「見出し＋説明」を出す。見出しは設定の「コンテキスト表示」（使用済み／残り）に従う。圧縮直後で使用量が未確定の間は、直前の値を表示し続ける。",
      },
    },
  },
  args: { state: "通常" },
  argTypes: {
    state: { control: "inline-radio", options: Object.keys(states) },
  },
} satisfies Meta<HoverArgs>;
export default meta;
type Story = StoryObj<HoverArgs>;

export const States: Story = {
  name: "状態ごとの表示",
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="tt-page">
      <ContextMeterStates />
    </div>
  ),
};

export const Hover: Story = {
  name: "Composerでホバー",
  render: (args) => (
    <div className="tt-page">
      <ContextMeterHover {...args} />
    </div>
  ),
};
