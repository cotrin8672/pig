import type { Meta } from "@storybook/react-vite";
import {
  ProviderIcon,
  providerIconIds,
} from "../../mainview/primitives/ProviderIcon";
import { PrimitiveSpecimen } from "./PrimitiveSpecimen";

export default {
  title: "Design System/Primitives/ProviderIcon",
  component: ProviderIcon,
  parameters: { gallery: true },
} satisfies Meta<typeof ProviderIcon>;

export const Providers = {
  name: "ProviderIcon",
  render: () => (
    <PrimitiveSpecimen
      title="ProviderIcon"
      intro="プロバイダー名にロゴを添えます。未登録のIDには汎用アイコンを使います。"
      context="モデル選択"
      variants={[...providerIconIds, "google-vertex-regional", "未登録"].map(
        (provider) => ({
          label: provider,
          sample: <ProviderIcon provider={provider} />,
        }),
      )}
    >
      <div className="ds-specimen-line">
        <ProviderIcon provider="anthropic" size={16} /> Claude
      </div>
    </PrimitiveSpecimen>
  ),
};
