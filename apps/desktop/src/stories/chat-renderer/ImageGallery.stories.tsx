import type { Meta } from "@storybook/react-vite";
import { ImageGallery } from "../../mainview/ImageGallery";
import { PrimitiveSpecimen } from "../design-system/PrimitiveSpecimen";
import { StoryTurn } from "../StoryTurn";
import { designData } from "./response-data";

export default {
  title: "ChatRenderer/Messages/ImageGallery",
  component: ImageGallery,
  parameters: { gallery: true },
} satisfies Meta<typeof ImageGallery>;

export const States = {
  name: "ImageGallery",
  render: () => (
    <PrimitiveSpecimen
      layer="ChatRenderer"
      title="ImageGallery"
      intro="会話に含まれる画像を表示し、選んだ画像を拡大できます。"
      context="複数の添付画像"
      variants={[
        {
          label: "画像1枚",
          sample: (
            <StoryTurn>
              <ImageGallery
                sources={designData.images.slice(0, 1)}
                alt="pig のロゴ"
              />
            </StoryTurn>
          ),
        },
      ]}
    >
      <StoryTurn>
        <ImageGallery sources={designData.images} alt="pig のロゴ" />
      </StoryTurn>
    </PrimitiveSpecimen>
  ),
};
