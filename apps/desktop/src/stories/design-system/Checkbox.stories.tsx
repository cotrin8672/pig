import type { Meta } from "@storybook/react-vite";
import { Checkbox } from "../../mainview/primitives/Checkbox";
import { PrimitiveSpecimen } from "./PrimitiveSpecimen";

export default {
  title: "Design System/Primitives/Checkbox",
  component: Checkbox,
  parameters: { gallery: true },
} satisfies Meta<typeof Checkbox>;
export const States = {
  render: () => (
    <PrimitiveSpecimen
      title="Checkbox"
      intro="一覧から対象を選択します。グループの一部だけ選んだ状態も表せます。"
      context="履歴インポート"
      variants={[
        { label: "未選択", sample: <Checkbox aria-label="未選択" /> },
        {
          label: "選択済み",
          sample: <Checkbox aria-label="選択済み" defaultChecked />,
        },
        { label: "一部選択", sample: <Checkbox aria-label="一部選択" mixed /> },
        { label: "無効", sample: <Checkbox aria-label="無効" disabled /> },
      ]}
    >
      <label className="ds-specimen-line">
        <Checkbox />
        この会話を取り込む
      </label>
    </PrimitiveSpecimen>
  ),
};
