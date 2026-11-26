import type { Meta } from "@storybook/react-vite";
import { Trash2 } from "lucide-react";
import { useState } from "react";
import { ConfirmButton } from "../../mainview/patterns/ConfirmButton";
import { PrimitiveSpecimen } from "./PrimitiveSpecimen";

export default {
  title: "Design System/Patterns/ConfirmButton",
  component: ConfirmButton,
  parameters: { gallery: true },
} satisfies Meta<typeof ConfirmButton>;

export const Default = {
  name: "ConfirmButton",
  render: function Example() {
    const [count, setCount] = useState(0);
    return (
      <PrimitiveSpecimen
        layer="Patterns"
        title="ConfirmButton"
        intro="取り消せない操作を2回押しで確定します。1回目でリングが減り始め、3秒・Escape・フォーカス移動で取り消されます。"
        context="パッケージのアンインストール"
        variants={[
          {
            label: "補助操作",
            sample: <ConfirmButton onConfirm={() => {}}>削除</ConfirmButton>,
          },
          {
            label: "主操作",
            sample: (
              <ConfirmButton className="primary" onConfirm={() => {}}>
                アンインストール
              </ConfirmButton>
            ),
          },
          {
            label: "無効",
            sample: (
              <ConfirmButton disabled onConfirm={() => {}}>
                削除
              </ConfirmButton>
            ),
          },
        ]}
      >
        <div className="ds-specimen-line">
          <ConfirmButton
            className="primary"
            onConfirm={() => setCount((n) => n + 1)}
          >
            <Trash2 size={13} /> アンインストール
          </ConfirmButton>
          <output>確定回数：{count}</output>
        </div>
      </PrimitiveSpecimen>
    );
  },
};
