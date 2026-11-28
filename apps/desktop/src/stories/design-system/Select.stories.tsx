import type { Meta } from "@storybook/react-vite";
import { Select } from "../../mainview/primitives/Select";
import { PrimitiveSpecimen } from "./PrimitiveSpecimen";

export default {
  title: "Design System/Primitives/Select",
  component: Select,
  parameters: { gallery: true },
} satisfies Meta<typeof Select>;
const choices = (
  <>
    <option value="">選択…</option>
    <option value="ja">日本語</option>
    <option value="en">英語</option>
  </>
);
export const States = {
  name: "Select",
  render: () => (
    <PrimitiveSpecimen
      title="Select"
      intro="候補からひとつを選びます。候補一覧は140msでフェードインしながら拡大し、閉じるときは80msでフェードアウトします。"
      context="表示設定"
      variants={[
        {
          label: "未選択",
          sample: <Select aria-label="未選択">{choices}</Select>,
        },
        {
          label: "選択済み",
          sample: (
            <Select aria-label="選択済み" defaultValue="ja">
              {choices}
            </Select>
          ),
        },
        {
          label: "無効",
          sample: (
            <Select aria-label="無効" defaultValue="ja" disabled>
              {choices}
            </Select>
          ),
        },
      ]}
    >
      <label className="ds-specimen-line">
        言語<Select defaultValue="ja">{choices}</Select>
      </label>
    </PrimitiveSpecimen>
  ),
};
