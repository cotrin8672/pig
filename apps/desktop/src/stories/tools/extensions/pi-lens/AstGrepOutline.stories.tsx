import { phaseControls } from "../../../proposals/kit";
import { astOutline } from "../../../proposals/lens-data";
import { lensStories } from "../../../proposals/lens-kit";
import { outlineProposals } from "../../../proposals/lens-read";

export default {
  title: "Chat/Tools/Extensions/pi-lens/ast_grep_outline",
  ...phaseControls,
};
const stories = lensStories(astOutline, outlineProposals);
export const Default = stories.Default;
export const Compare = stories.Compare;
export const Folded = stories.Folded;
export const Tiles = stories.Tiles;
export const Sizes = stories.Sizes;
export const Sentence = stories.Sentence;
export const Table = stories.Table;
