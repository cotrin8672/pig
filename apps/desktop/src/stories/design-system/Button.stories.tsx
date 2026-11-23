import type { Meta } from "@storybook/react-vite";
import { useState } from "react";
import { Button } from "../../mainview/primitives/Button";
import { PrimitiveSpecimen } from "./PrimitiveSpecimen";

export default {
  title: "Design System/Primitives/Button",
  component: Button,
  parameters: { gallery: true },
} satisfies Meta<typeof Button>;

export const States = {
  render: function Example() {
    const [saved, setSaved] = useState(0);
    return (
      <PrimitiveSpecimen
        title="Button"
        intro="主操作と補助操作を強調度で区別します。"
        context="設定の保存"
        variants={[
          { label: "主操作", sample: <Button variant="primary">保存</Button> },
          { label: "補助操作", sample: <Button>キャンセル</Button> },
          { label: "無効", sample: <Button disabled>保存</Button> },
        ]}
      >
        <div className="ds-specimen-line">
          <Button variant="primary" onClick={() => setSaved((n) => n + 1)}>
            保存
          </Button>
          <output>保存回数：{saved}</output>
        </div>
      </PrimitiveSpecimen>
    );
  },
};
