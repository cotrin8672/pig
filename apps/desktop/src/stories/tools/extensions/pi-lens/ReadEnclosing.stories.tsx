import { phaseControls } from "../../../proposals/kit";
import { readEnclosing } from "../../../proposals/lens-data";
import { lensStories } from "../../../proposals/lens-kit";
import { readEnclosingProposals } from "../../../proposals/lens-read";

export default {
  title: "Chat/Tools/Extensions/pi-lens/read_enclosing",
  ...phaseControls,
};
const stories = lensStories(readEnclosing, readEnclosingProposals);
export const Default = stories.Default;
export const Compare = stories.Compare;
export const Tab = stories.Tab;
export const Focus = stories.Focus;
export const Doc = stories.Doc;
export const Bracket = stories.Bracket;
export const Fold = stories.Fold;
