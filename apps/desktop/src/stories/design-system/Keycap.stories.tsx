import type { Meta } from "@storybook/react-vite";
import { Keycap } from "../../mainview/primitives/Keycap";
import { PrimitiveSpecimen } from "./PrimitiveSpecimen";

export default {
  title: "Design System/Primitives/Keycap",
  component: Keycap,
  parameters: { gallery: true },
} satisfies Meta<typeof Keycap>;

export const States = {
  render: () => (
    <PrimitiveSpecimen
      title="Keycap"
      intro="操作に使うキーを、説明文と区別して読めるようにします。"
      context="検索パレット"
      variants={[
        ["K", "文字"],
        ["Enter", "決定"],
        ["Esc", "閉じる"],
        ["ArrowLeft", "左へ"],
        ["ArrowDown", "下へ"],
      ].map(([key, label]) => ({
        label,
        sample: <Keycap>{key}</Keycap>,
      }))}
    >
      <div className="ds-specimen-line">
        <Keycap>Enter</Keycap> 開く
        <Keycap>Esc</Keycap> 閉じる
      </div>
    </PrimitiveSpecimen>
  ),
};
