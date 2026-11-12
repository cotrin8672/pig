import { contentStories } from "../DesignProposals";
import { Annotations, SentAnnotations } from "../item-fixtures";
export default { title: "Chat/Review/Annotations" };
const stories = contentStories("annotations", SentAnnotations.render);
export const Default = {
  ...stories.Default,
  parameters: SentAnnotations.parameters,
};
export const ReviewMatrix = stories.Rail;
export const InlineReview = stories.Sheet;
export const CommentInspector = stories.Folded;
export const AnnotationComparison = { ...stories.Compare, name: "Compare all" };
export const Selection = { render: Annotations };
