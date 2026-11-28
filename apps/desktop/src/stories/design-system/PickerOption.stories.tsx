import type { Meta } from "@storybook/react-vite";
import { Laptop, Monitor } from "lucide-react";
import { useState } from "react";
import { PickerOption } from "../../mainview/patterns/PickerOption";
import { PrimitiveSpecimen } from "./PrimitiveSpecimen";

export default {
  title: "Design System/Patterns/PickerOption",
  component: PickerOption,
  parameters: { gallery: true },
} satisfies Meta<typeof PickerOption>;

function OptionsExample() {
  const [local, setLocal] = useState(true);
  return (
    <div role="listbox" aria-label="接続先のPC">
      <PickerOption
        label="このPC"
        icon={<Laptop size={13} aria-hidden="true" />}
        selected={local}
        onClick={() => setLocal(true)}
      />
      <PickerOption
        label="作業用PC"
        icon={<Monitor size={13} aria-hidden="true" />}
        detail={<small>接続済み</small>}
        selected={!local}
        onClick={() => setLocal(false)}
      />
    </div>
  );
}

export const States = {
  name: "PickerOption",
  render: () => (
    <PrimitiveSpecimen
      layer="Patterns"
      wide
      title="PickerOption"
      intro="モデルや接続先を選ぶ一覧の候補行です。選択した候補には右端にチェックが付きます。"
      context="接続先の切り替え"
      variants={[
        {
          label: "選択済み",
          sample: (
            <div role="listbox" aria-label="選択済みの候補">
              <PickerOption label="このPC" selected />
            </div>
          ),
        },
        {
          label: "ハイライト",
          sample: (
            <div role="listbox" aria-label="ハイライト中の候補">
              <PickerOption label="作業用PC" selected={false} highlighted />
            </div>
          ),
        },
        {
          label: "選択不可",
          sample: (
            <div role="listbox" aria-label="選択できない候補">
              <PickerOption label="オフラインのPC" selected={false} disabled />
            </div>
          ),
        },
      ]}
    >
      <OptionsExample />
    </PrimitiveSpecimen>
  ),
};
