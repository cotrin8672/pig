import { phaseControls } from "../../../proposals/kit";
import { symbolSearch } from "../../../proposals/lens-data";
import { lensStories } from "../../../proposals/lens-kit";
import { symbolSearchProposals } from "../../../proposals/lens-search";

export default {
  title: "Chat/Tools/Extensions/pi-lens/symbol_search",
  ...phaseControls,
};
const stories = lensStories(symbolSearch, symbolSearchProposals);
export const Default = stories.Default;
export const Compare = stories.Compare;
export const Board = stories.Board;
export const Rings = stories.Rings;
export const Strength = stories.Strength;
export const Folders = stories.Folders;
export const Flow = stories.Flow;
