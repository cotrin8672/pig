import { grep } from "../proposals/data";
import { phaseControls, toolStories } from "../proposals/kit";
import { grepProposals } from "../proposals/tools";

export default { title: "Chat/Tools/Grep", ...phaseControls };
const stories = toolStories(grep, grepProposals);
export const Default = stories.Default;
export const Compare = stories.Compare;
export const Groups = stories.Groups;
export const Distribution = stories.Distribution;
export const Sentence = stories.Sentence;
