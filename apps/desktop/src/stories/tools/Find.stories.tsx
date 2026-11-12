import { find } from "../proposals/data";
import { phaseControls, toolStories } from "../proposals/kit";
import { findProposals } from "../proposals/tools";

export default { title: "Chat/Tools/Find", ...phaseControls };
const stories = toolStories(find, findProposals);
export const Default = stories.Default;
export const Compare = stories.Compare;
export const Tree = stories.Tree;
export const Matched = stories.Matched;
export const Facets = stories.Facets;
