import type { Meta } from "@storybook/react-vite";
import { Spinner } from "../../mainview/primitives/Spinner";
import { PrimitiveSpecimen } from "./PrimitiveSpecimen";

export default {
  title: "Design System/Primitives/Spinner",
  component: Spinner,
  parameters: { gallery: true },
} satisfies Meta<typeof Spinner>;
export const States = {
  render: () => (
    <PrimitiveSpecimen
      title="Spinner"
      intro="処理中であることをラベルに添えて示します。"
      context="プロバイダー接続"
      variants={[11, 14, 17].map((size) => ({
        label: `${size}px`,
        sample: <Spinner size={size} />,
      }))}
    >
      <div className="ds-specimen-line">
        <Spinner />
        接続中…
      </div>
    </PrimitiveSpecimen>
  ),
};
