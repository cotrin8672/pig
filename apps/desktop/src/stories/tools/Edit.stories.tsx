import { edit } from "../proposals/data";
import { phaseControls, toolStories } from "../proposals/kit";
import { editProposals } from "../proposals/tools";

export default { title: "Chat/Tools/Edit", ...phaseControls };
const stories = toolStories(edit, editProposals);
export const Default = stories.Default;
export const Compare = stories.Compare;
export const WordDiff = stories.WordDiff;
export const Summary = stories.Summary;
export const Hunks = stories.Hunks;
