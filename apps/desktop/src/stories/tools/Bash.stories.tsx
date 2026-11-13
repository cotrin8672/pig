import { bashProposals } from "../proposals/bash";
import { bash } from "../proposals/data";
import { phaseControls, toolStories } from "../proposals/kit";
import { shellProposals } from "../proposals/tools";

export default { title: "Chat/Tools/Bash", ...phaseControls };
const stories = toolStories(bash, { ...shellProposals, ...bashProposals });
export const Default = stories.Default;
export const Compare = stories.Compare;
export const Terminal = stories.Terminal;
export const Verdict = stories.Verdict;
export const HeadTail = stories.HeadTail;
export const Frosted = stories.Frosted;
export const Tinted = stories.Tinted;
export const Well = stories.Well;
export const MiniWindow = stories.MiniWindow;
export const Rail = stories.Rail;
export const OnePane = stories.OnePane;
