import { phaseControls } from "../../../proposals/kit";
import { astReplace } from "../../../proposals/lens-data";
import { lensStories } from "../../../proposals/lens-kit";

/** pi-lens renders every tool as the shipped relation map. */
export default {
  title: "Chat/Tools/Extensions/pi-lens/ast_grep_replace",
  ...phaseControls,
};
export const Default = lensStories(astReplace, {}).Default;
