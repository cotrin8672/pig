import type { Meta } from "@storybook/react-vite";
import { ProviderIcon } from "../../mainview/ProviderIcon";
import { UsageMeter } from "../../mainview/UsageMeter";
import { PrimitiveSpecimen } from "./PrimitiveSpecimen";

export default {
  title: "Design System/Domain/UsageMeter",
  component: UsageMeter,
  parameters: { gallery: true },
} satisfies Meta<typeof UsageMeter>;

function meter(
  quotaPercent: number,
  timePercent?: number,
  tone?: React.ComponentProps<typeof UsageMeter>["tone"],
) {
  return (
    <span style={{ width: 72, maxWidth: "100%" }}>
      <UsageMeter
        quotaPercent={quotaPercent}
        timePercent={timePercent}
        tone={tone}
        label={`容量 ${quotaPercent}%、リセットまでの残り時間 ${timePercent === undefined ? "不明" : `${timePercent}%`}`}
      />
    </span>
  );
}

export const States = {
  name: "UsageMeter",
  render: () => (
    <PrimitiveSpecimen
      layer="Domain"
      title="UsageMeter"
      intro="内側の塗りで容量、外側の枠線でリセットまでの残り時間を示します。時間が不明なら外側の強調線は表示しません。"
      context="サイドバーの使用量"
      variants={[
        { label: "通常", sample: meter(54, 72) },
        { label: "警告", sample: meter(24, 58, "warning") },
        { label: "上限付近", sample: meter(9, 46, "critical") },
        { label: "時間不明", sample: meter(40) },
        { label: "リセット直前", sample: meter(64, 0) },
      ]}
    >
      <div className="ds-specimen-line">
        <ProviderIcon provider="openai-codex" size={12} />
        <span>Personal</span>
        {meter(54, 72)}
        <span aria-hidden="true">54%</span>
      </div>
    </PrimitiveSpecimen>
  ),
};
