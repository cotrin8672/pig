import { phaseControls } from "../../../proposals/kit";
import { activateTools } from "../../../proposals/lens-data";
import { lensStories } from "../../../proposals/lens-kit";

/** pi-lens renders every tool as the shipped relation map. */
export default {
  title: "Chat/Tools/Extensions/pi-lens/pi_lens_activate_tools",
  ...phaseControls,
};
export const Default = lensStories(activateTools, {}).Default;
