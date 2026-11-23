import type { Meta } from "@storybook/react-vite";
import { IndicatorDot } from "../../mainview/primitives/IndicatorDot";
import { PrimitiveSpecimen } from "./PrimitiveSpecimen";

export default {
  title: "Design System/Primitives/IndicatorDot",
  component: IndicatorDot,
  parameters: { gallery: true },
} satisfies Meta<typeof IndicatorDot>;

export const States = {
  render: () => (
    <PrimitiveSpecimen
      title="IndicatorDot"
      intro="会話の進行と未読を、タイトルのそばに小さな光で示します。"
      context="会話一覧"
      variants={(
        [
          ["running", "実行中"],
          ["waiting", "入力待ち"],
          ["completed", "完了"],
          ["failed", "失敗"],
          ["unread", "未読"],
        ] as const
      ).map(([state, label]) => ({
        label,
        sample: <IndicatorDot state={state} />,
      }))}
    >
      <div className="ds-specimen-line">
        <IndicatorDot state="running" /> デザインの見直し <small>実行中</small>
      </div>
      <div className="ds-specimen-line">
        <IndicatorDot state="waiting" /> 変更内容の確認 <small>入力待ち</small>
      </div>
    </PrimitiveSpecimen>
  ),
};
