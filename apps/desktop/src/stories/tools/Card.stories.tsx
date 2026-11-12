import { card } from "../proposals/data";
import { phaseControls, toolStories } from "../proposals/kit";
import { cardProposals } from "../proposals/tools";

export default { title: "Chat/Tools/Configured card", ...phaseControls };
const stories = toolStories(card, cardProposals);
export const Default = stories.Default;
export const Compare = stories.Compare;
export const Report = stories.Report;
export const Summary = stories.Summary;
export const Progress = stories.Progress;
