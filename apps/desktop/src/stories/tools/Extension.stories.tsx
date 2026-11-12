import { lookup } from "../proposals/data";
import { phaseControls, toolStories } from "../proposals/kit";
import { extensionProposals } from "../proposals/tools";

export default { title: "Chat/Tools/Extension", ...phaseControls };
const stories = toolStories(lookup, extensionProposals);
export const Default = stories.Default;
export const Compare = stories.Compare;
export const Signature = stories.Signature;
export const Table = stories.Table;
export const ResultFirst = stories.ResultFirst;
