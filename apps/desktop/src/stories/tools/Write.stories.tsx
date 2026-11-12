import { write } from "../proposals/data";
import { phaseControls, toolStories } from "../proposals/kit";
import { writeProposals } from "../proposals/tools";

export default { title: "Chat/Tools/Write", ...phaseControls };
const stories = toolStories(write, writeProposals);
export const Default = stories.Default;
export const Compare = stories.Compare;
export const Placement = stories.Placement;
export const Outline = stories.Outline;
export const Artifact = stories.Artifact;
