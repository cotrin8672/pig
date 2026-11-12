import { WorkDefault, workProposals } from "../proposals/content";
import { contentStories } from "../proposals/kit";

export default { title: "Chat/Activity/Work" };
const stories = contentStories(workProposals, WorkDefault);
export const Default = stories.Default;
export const Compare = stories.Compare;
export const Strip = stories.Strip;
export const Chapters = stories.Chapters;
export const Outcome = stories.Outcome;
