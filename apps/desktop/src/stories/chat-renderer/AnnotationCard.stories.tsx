import type { Meta } from "@storybook/react-vite";
import { AnnotationCard } from "../../mainview/AnnotationCards";
import { PrimitiveSpecimen } from "../design-system/PrimitiveSpecimen";
import { StoryTurn } from "../StoryTurn";
import { designData } from "./response-data";

export default {
  title: "ChatRenderer/Messages/AnnotationCard",
  component: AnnotationCard,
  parameters: { gallery: true },
} satisfies Meta<typeof AnnotationCard>;

const draw = ({ quote, comment }: (typeof designData.annotations)[number]) => (
  <StoryTurn speaker="user">
    <ul className="user-annotations">
      <AnnotationCard quote={quote} comment={comment} />
    </ul>
  </StoryTurn>
);

export const States = {
  name: "AnnotationCard",
  render: () => (
    <PrimitiveSpecimen
      layer="ChatRenderer"
      title="AnnotationCard"
      intro="引用した本文と添えたコメントを表示します。長文はクリックで展開できます。"
      context="コメント付きの引用"
      variants={[
        {
          label: "長い引用とコメント",
          sample: draw(designData.annotations[1]),
        },
        { label: "コメントなし", sample: draw(designData.annotations[2]) },
      ]}
    >
      {draw(designData.annotations[0])}
    </PrimitiveSpecimen>
  ),
};
