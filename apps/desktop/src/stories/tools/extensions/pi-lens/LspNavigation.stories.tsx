import { phaseControls } from "../../../proposals/kit";
import { lspNavigation } from "../../../proposals/lens-data";
import { lensStories } from "../../../proposals/lens-kit";

/** pi-lens renders every tool as the shipped relation map. */
export default {
  title: "Chat/Tools/Extensions/pi-lens/lsp_navigation",
  ...phaseControls,
};
export const Default = lensStories(lspNavigation, {}).Default;
