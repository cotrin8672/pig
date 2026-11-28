import type { Meta } from "@storybook/react-vite";
import { Puzzle } from "lucide-react";
import { IconButton } from "../../mainview/primitives/IconButton";
import {
  TooltipBody,
  TooltipLayer,
  type TooltipTier,
  tooltipClass,
  useTooltip,
} from "../../mainview/Tooltip";
import { samples, tierNames } from "../tooltips/TooltipPreview";
import { PrimitiveSpecimen } from "./PrimitiveSpecimen";

export default {
  title: "Design System/Patterns/Tooltip",
  component: TooltipLayer,
  parameters: {
    gallery: true,
    themeColor: "#7DBFBD",
    neutralWallpaper: true,
  },
} satisfies Meta<typeof TooltipLayer>;

function ExtensionButton() {
  const tip = useTooltip();
  return (
    <IconButton
      aria-label="拡張機能"
      {...tip({ ...samples.label, side: "top" })}
    >
      <Puzzle size={16} aria-hidden="true" />
    </IconButton>
  );
}

export const States = {
  name: "Tooltip",
  render: () => (
    <PrimitiveSpecimen
      layer="Patterns"
      wide
      title="Tooltip"
      intro="ホバーやキーボードフォーカスで操作の補足を表示します。内容に応じて、短いラベルから値の一覧まで使い分けます。"
      context="サイドバーの拡張機能（ホバーまたはTab）"
      variants={(Object.keys(tierNames) as TooltipTier[]).map((tier) => ({
        label: tierNames[tier],
        sample: (
          <div
            className={tooltipClass(tier)}
            style={{
              position: "static",
              justifySelf: "start",
              maxWidth: "min(100%, 280px)",
            }}
          >
            <TooltipBody content={samples[tier]} />
          </div>
        ),
      }))}
    >
      <TooltipLayer>
        <ExtensionButton />
      </TooltipLayer>
    </PrimitiveSpecimen>
  ),
};
