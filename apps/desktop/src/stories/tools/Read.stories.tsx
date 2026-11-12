import { read } from "../proposals/data";
import { phaseControls, toolStories } from "../proposals/kit";
import { readProposals } from "../proposals/tools";

export default { title: "Chat/Tools/Read", ...phaseControls };
const stories = toolStories(read, readProposals);
export const Default = stories.Default;
export const Compare = stories.Compare;
export const RangeMap = stories.RangeMap;
export const Citation = stories.Citation;
export const Peek = stories.Peek;
