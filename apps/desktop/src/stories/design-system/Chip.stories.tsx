import type { Meta } from "@storybook/react-vite";
import { Chip } from "../../mainview/primitives/Chip";
import { PrimitiveSpecimen } from "./PrimitiveSpecimen";

export default {
  title: "Design System/Primitives/Chip",
  component: Chip,
  parameters: { gallery: true },
} satisfies Meta<typeof Chip>;

export const States = {
  render: () => (
    <PrimitiveSpecimen
      title="Chip"
      intro="モデル名や属性など、本文に添える短い情報をまとめます。"
      context="応答フッター"
      variants={[
        { label: "メタデータ", sample: <Chip>42 tokens/s</Chip> },
        { label: "通常タグ", sample: <Chip variant="tag">既定</Chip> },
        { label: "強調タグ", sample: <Chip variant="accent-tag">拡張</Chip> },
      ]}
    >
      <div className="ds-specimen-line">
        <strong>応答完了</strong>
        <small>12 秒</small>
      </div>
      <div className="ds-specimen-line">
        <Chip>GPT-5.4</Chip>
        <Chip>42 tokens/s · 1.2k</Chip>
      </div>
    </PrimitiveSpecimen>
  ),
};
