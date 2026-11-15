import { phaseControls } from "../../../proposals/kit";
import { astSearch } from "../../../proposals/lens-data";
import { lensStories } from "../../../proposals/lens-kit";
import { astSearchProposals } from "../../../proposals/lens-search";

export default {
  title: "Chat/Tools/Extensions/pi-lens/ast_grep_search",
  ...phaseControls,
};
const stories = lensStories(astSearch, astSearchProposals);
export const Default = stories.Default;
export const Compare = stories.Compare;
export const Compiler = stories.Compiler;
export const Anatomy = stories.Anatomy;
export const Console = stories.Console;
export const Ticks = stories.Ticks;
export const Headline = stories.Headline;
