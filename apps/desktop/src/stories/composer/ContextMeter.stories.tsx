import type { Meta, StoryObj } from "@storybook/react-vite";
import { ContextMeterHover } from "./ContextMeterHover";
import { ContextMeterStates } from "./ContextMeterStates";
import { type HoverArgs, states } from "./context-meter-fixtures";
import "../tooltips/tooltips.css";
import "./model-trigger.css";
import "./context-meter.css";

const meta = {
  id: "chat-composer-context-meter",
  title: "Design System/Components/ContextMeter",
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
  name: "ContextMeter",
  render: (args) => (
    <div className="tt-page">
      <ContextMeterStates />
      <h3>ホバーで確認</h3>
      <ContextMeterHover {...args} />
    </div>
  ),
};
