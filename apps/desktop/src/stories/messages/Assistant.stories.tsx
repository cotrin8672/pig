import { AnswerDefault, assistantProposals } from "../proposals/content";
import { contentStories } from "../proposals/kit";

export default { title: "Chat/Messages/Assistant" };
const stories = contentStories(assistantProposals, AnswerDefault);
export const Default = stories.Default;
export const Compare = stories.Compare;
export const Lead = stories.Lead;
export const Outline = stories.Outline;
export const Ask = stories.Ask;
