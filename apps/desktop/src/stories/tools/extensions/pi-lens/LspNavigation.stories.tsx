import { phaseControls } from "../../../proposals/kit";
import { lspNavigation } from "../../../proposals/lens-data";
import { lensStories } from "../../../proposals/lens-kit";
import { lspNavigationProposals } from "../../../proposals/lens-search";

export default {
  title: "Chat/Tools/Extensions/pi-lens/lsp_navigation",
  ...phaseControls,
};
const stories = lensStories(lspNavigation, lspNavigationProposals);
export const Default = stories.Default;
export const Compare = stories.Compare;
export const Hierarchy = stories.Hierarchy;
export const Segments = stories.Segments;
export const Table = stories.Table;
export const Ribbon = stories.Ribbon;
export const Hero = stories.Hero;
