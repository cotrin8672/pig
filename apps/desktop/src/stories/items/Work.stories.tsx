import { contentStories } from "../DesignProposals";
import { Work } from "../item-fixtures";
export default { title: "Chat/Activity/Work" };
const stories = contentStories("work", Work);
export const Default = stories.Default;
export const WorkTimeline = stories.Rail;
export const WorkSummary = stories.Sheet;
export const ActivityConsole = stories.Folded;
export const WorkComparison = { ...stories.Compare, name: "Compare all" };
