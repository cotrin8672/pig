import { contentStories } from "../DesignProposals";
import { AssistantMarkdown } from "../item-fixtures";
export default { title: "Chat/Messages/Assistant" };
const stories = contentStories("assistant", AssistantMarkdown);
export const Default = stories.Default;
export const AnswerSpread = stories.Rail;
export const EvidenceBoard = stories.Sheet;
export const TabbedAnswer = stories.Folded;
export const AnswerComparison = { ...stories.Compare, name: "Compare all" };
