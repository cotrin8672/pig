import { powershell } from "../proposals/data";
import { phaseControls, toolStories } from "../proposals/kit";
import { shellProposals } from "../proposals/tools";

export default { title: "Chat/Tools/PowerShell", ...phaseControls };
const stories = toolStories(powershell, shellProposals);
export const Default = stories.Default;
export const Compare = stories.Compare;
export const Terminal = stories.Terminal;
export const Verdict = stories.Verdict;
export const HeadTail = stories.HeadTail;
