import type { Meta } from "@storybook/react-vite";
import { CatalogPage } from "../design-system/ReviewPage";
import { EffortLevelsPreview } from "./ModelTriggerPreview";

export default {
  title: "Design System/Components/EffortChip",
  parameters: { gallery: true },
} satisfies Meta;

export const States = {
  name: "EffortChip",
  render: () => (
    <CatalogPage
      title="EffortChip"
      intro="モデルが対応する段階を並べて比較します。"
    >
      <EffortLevelsPreview />
    </CatalogPage>
  ),
};
