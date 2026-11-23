import type { Meta } from "@storybook/react-vite";
import { Switch } from "../../mainview/primitives/Switch";
import { PrimitiveSpecimen } from "./PrimitiveSpecimen";

export default {
  title: "Design System/Primitives/Switch",
  component: Switch,
  parameters: { gallery: true },
} satisfies Meta<typeof Switch>;
export const States = {
  name: "Switch",
  render: () => (
    <PrimitiveSpecimen
      title="Switch"
      intro="設定のオン・オフを切り替えます。"
      context="モデル設定"
      variants={[
        {
          label: "オフ",
          sample: (
            <label>
              <Switch aria-label="オフ" />
            </label>
          ),
        },
        {
          label: "オン",
          sample: (
            <label>
              <Switch aria-label="オン" defaultChecked />
            </label>
          ),
        },
        {
          label: "一部オン",
          sample: (
            <label>
              <Switch aria-label="一部オン" mixed />
            </label>
          ),
        },
        {
          label: "無効",
          sample: (
            <label>
              <Switch aria-label="無効" disabled />
            </label>
          ),
        },
      ]}
    >
      <label className="ds-specimen-line">
        <Switch defaultChecked />
        画像入力を許可
      </label>
    </PrimitiveSpecimen>
  ),
};
