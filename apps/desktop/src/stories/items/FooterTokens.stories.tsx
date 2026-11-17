import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  type FooterTokenArgs,
  FooterTokenHover,
  FooterTokenStates,
  usages,
} from "./FooterTokensPreview";

const meta = {
  title: "Chat/Activity/Response footer tokens",
  parameters: {
    windowPreview: true,
    docs: {
      description: {
        component:
          "応答フッターの「tokens/s · 合計」チップにホバーすると、その応答（直前のユーザー発言以降のassistantメッセージの合計）のトークン内訳を共通Tooltipの値の一覧（見出しなし）で出す（`mainview/ResponseFooter.tsx` の `usageTip`）。料金はpi-aiがモデルの定価から計算したAPI換算で、0（料金不明）なら行ごと出さない。",
      },
    },
  },
  args: { state: "通常" },
  argTypes: {
    state: { control: "inline-radio", options: Object.keys(usages) },
  },
} satisfies Meta<FooterTokenArgs>;
export default meta;
type Story = StoryObj<FooterTokenArgs>;

export const States: Story = {
  name: "状態ごとの表示",
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="tt-page">
      <FooterTokenStates />
    </div>
  ),
};

export const Hover: Story = {
  name: "フッターでホバー",
  render: (args) => (
    <div className="tt-page">
      <FooterTokenHover {...args} />
    </div>
  ),
};
