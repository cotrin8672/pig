import type { Meta } from "@storybook/react-vite";
import icon from "../../../assets/icon.png";
import iconVector from "../../../assets/icon.svg";
import { ImagePreview } from "../../mainview/ImageGallery";
import { PrimitiveSpecimen } from "./PrimitiveSpecimen";

export default {
  title: "Design System/Patterns/ImagePreview",
  component: ImagePreview,
  parameters: { gallery: true },
} satisfies Meta<typeof ImagePreview>;

export const States = {
  name: "ImagePreview",
  render: () => (
    <PrimitiveSpecimen
      layer="Patterns"
      title="ImagePreview"
      intro="サムネイルから共通の画像ビューアーを開きます。複数枚は矢印で切り替え、Escapeで閉じると元の画像にフォーカスが戻ります。"
      context="送信前の添付画像"
      variants={[
        {
          label: "画像1枚",
          sample: (
            <div style={{ width: 52 }}>
              <ImagePreview sources={[icon]} alt="pig のアイコン" />
            </div>
          ),
        },
        {
          label: "複数画像の途中から開く",
          sample: (
            <div style={{ width: 52 }}>
              <ImagePreview
                sources={[icon, iconVector]}
                index={1}
                alt="pig のアイコン"
              />
            </div>
          ),
        },
      ]}
    >
      <div style={{ width: 96 }}>
        <ImagePreview sources={[icon, iconVector]} alt="pig のアイコン" />
      </div>
    </PrimitiveSpecimen>
  ),
};
