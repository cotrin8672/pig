import type { Meta } from "@storybook/react-vite";
import { useState } from "react";
import { ColorPicker, colorPresets } from "../../mainview/ColorPicker";
import { SettingsCard } from "../../mainview/patterns/SettingsCard";
import { SettingsRow } from "../../mainview/patterns/SettingsRow";
import { PrimitiveSpecimen } from "./PrimitiveSpecimen";

export default {
  title: "Design System/Patterns/ColorPicker",
  component: ColorPicker,
  parameters: { gallery: true },
} satisfies Meta<typeof ColorPicker>;

function SamplePicker({ initial }: { initial: string }) {
  const [value, setValue] = useState(initial);
  return <ColorPicker value={value} label="テーマカラー" onChange={setValue} />;
}

export const States = {
  name: "ColorPicker",
  render: () => (
    <PrimitiveSpecimen
      layer="Patterns"
      title="ColorPicker"
      intro="色面・色相・プリセット・HEX入力から色を選べます。ここでの変更は見本内だけに反映します。"
      context="外観設定のテーマカラー"
      variants={[
        {
          label: "テーマの初期色",
          sample: <SamplePicker initial={colorPresets[0]} />,
        },
        { label: "無彩色", sample: <SamplePicker initial="#a8a8a8" /> },
      ]}
    >
      <SettingsCard>
        <SettingsRow label="テーマカラー">
          <SamplePicker initial="#7dbfbd" />
        </SettingsRow>
      </SettingsCard>
    </PrimitiveSpecimen>
  ),
};
