import type { Meta } from "@storybook/react-vite";
import { IndicatorDot } from "../../mainview/IndicatorDot";
import { PrimitiveSpecimen } from "./PrimitiveSpecimen";

export default {
  title: "Design System/Domain/IndicatorDot",
  component: IndicatorDot,
  parameters: { gallery: true },
} satisfies Meta<typeof IndicatorDot>;

export const States = {
  name: "IndicatorDot",
  render: () => (
    <PrimitiveSpecimen
      layer="Domain"
      title="IndicatorDot"
      intro="会話の進行、未読や更新、PCの接続状態を小さな点で示します。"
      context="会話一覧"
      variants={(
        [
          ["running", "実行中"],
          ["waiting", "入力待ち"],
          ["completed", "完了"],
          ["failed", "失敗"],
          ["unread", "未読・更新"],
          ["connected", "接続済み"],
          ["offline", "オフライン"],
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
