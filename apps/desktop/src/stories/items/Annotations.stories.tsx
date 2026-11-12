import { Annotations } from "../item-fixtures";
import { AnnotationsDefault, annotationProposals } from "../proposals/content";
import { contentStories } from "../proposals/kit";

export default { title: "Chat/Review/Annotations" };
const stories = contentStories(annotationProposals, AnnotationsDefault);
export const Default = stories.Default;
export const Compare = stories.Compare;
export const Threads = stories.Threads;
export const Badge = stories.Badge;
export const Footnotes = stories.Footnotes;
export const Selection = { render: Annotations };
