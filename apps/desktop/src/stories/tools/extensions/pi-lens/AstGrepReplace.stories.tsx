import { phaseControls } from "../../../proposals/kit";
import { astReplace } from "../../../proposals/lens-data";
import { lensStories } from "../../../proposals/lens-kit";
import { astReplaceProposals } from "../../../proposals/lens-search";

export default {
  title: "Chat/Tools/Extensions/pi-lens/ast_grep_replace",
  ...phaseControls,
};
const stories = lensStories(astReplace, astReplaceProposals);
export const Default = stories.Default;
export const Compare = stories.Compare;
export const SideBySide = stories.SideBySide;
export const Checklist = stories.Checklist;
export const Codemod = stories.Codemod;
export const Stepper = stories.Stepper;
export const FileTiles = stories.FileTiles;
