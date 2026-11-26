import type { Meta } from "@storybook/react-vite";
import { RotateCcw, X } from "lucide-react";
import { IconButton } from "../../mainview/primitives/IconButton";
import { PrimitiveSpecimen } from "./PrimitiveSpecimen";

export default {
  title: "Design System/Primitives/IconButton",
  component: IconButton,
  parameters: { gallery: true },
} satisfies Meta<typeof IconButton>;
export const States = {
  name: "IconButton",
  render: () => (
    <PrimitiveSpecimen
      title="IconButton"
      intro="短い操作名を持つ、アイコンだけのボタンです。"
      context="ショートカット設定"
      variants={[
        {
          label: "リセット",
          sample: (
            <IconButton aria-label="リセット">
              <RotateCcw size={14} />
            </IconButton>
          ),
        },
        {
          label: "クリア",
          sample: (
            <IconButton aria-label="クリア">
              <X size={14} />
            </IconButton>
          ),
        },
        {
          label: "無効",
          sample: (
            <IconButton aria-label="クリア" disabled>
              <X size={14} />
            </IconButton>
          ),
        },
      ]}
    >
      <div className="ds-specimen-line">
        キー割り当て{" "}
        <IconButton aria-label="既定値に戻す">
          <RotateCcw size={14} />
        </IconButton>
      </div>
    </PrimitiveSpecimen>
  ),
};
