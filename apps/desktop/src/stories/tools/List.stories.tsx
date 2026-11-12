import { ls } from "../proposals/data";
import { phaseControls, toolStories } from "../proposals/kit";
import { lsProposals } from "../proposals/tools";

export default { title: "Chat/Tools/List", ...phaseControls };
const stories = toolStories(ls, lsProposals);
export const Default = stories.Default;
export const Compare = stories.Compare;
export const Icons = stories.Icons;
export const Summary = stories.Summary;
export const Columns = stories.Columns;
