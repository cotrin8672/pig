import { FooterDefault, footerProposals } from "../proposals/content";
import { contentStories } from "../proposals/kit";

export default { title: "Chat/Activity/Response footer" };
const stories = contentStories(footerProposals, FooterDefault);
export const Default = stories.Default;
export const Compare = stories.Compare;
export const Line = stories.Line;
export const Hover = stories.Hover;
export const Time = stories.Time;
