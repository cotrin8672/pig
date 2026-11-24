import type { Meta } from "@storybook/react-vite";
import { SettingsCard } from "../../mainview/patterns/SettingsCard";
import { SettingsRow } from "../../mainview/patterns/SettingsRow";
import { Select } from "../../mainview/primitives/Select";
import { Switch } from "../../mainview/primitives/Switch";
import { PrimitiveSpecimen } from "./PrimitiveSpecimen";

export default {
  title: "Design System/Patterns/SettingsCard",
  component: SettingsCard,
  parameters: { gallery: true },
} satisfies Meta<typeof SettingsCard>;

export const States = {
  name: "SettingsCard",
  render: () => (
    <PrimitiveSpecimen
      layer="Patterns"
      title="SettingsCard"
      intro="関連する設定行を1枚の半透明カードにまとめます。行の間には区切り線が入ります。"
      context="一般設定"
      variants={[
        {
          label: "1行",
          sample: (
            <SettingsCard>
              <SettingsRow label="画像をブロック">
                <label>
                  <Switch aria-label="画像をブロック" />
                </label>
              </SettingsRow>
            </SettingsCard>
          ),
        },
      ]}
    >
      <SettingsCard aria-label="一般">
        <SettingsRow label="言語">
          <Select aria-label="言語" defaultValue="ja">
            <option value="en">English</option>
            <option value="ja">日本語</option>
          </Select>
        </SettingsRow>
        <SettingsRow label="画像をブロック">
          <label>
            <Switch aria-label="画像をブロック" defaultChecked />
          </label>
        </SettingsRow>
      </SettingsCard>
    </PrimitiveSpecimen>
  ),
};
