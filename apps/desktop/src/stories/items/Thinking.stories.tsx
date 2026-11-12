import { ThinkingActive } from "../item-fixtures";
import { ThinkingDefault, thinkingProposals } from "../proposals/content";
import { contentStories } from "../proposals/kit";

export default { title: "Chat/Activity/Thinking" };
const stories = contentStories(thinkingProposals, ThinkingDefault);
export const Default = stories.Default;
export const Compare = stories.Compare;
export const Steps = stories.Steps;
export const Ticker = stories.Ticker;
export const Aside = stories.Aside;
export const Running = { render: ThinkingActive };
