import { phaseControls } from "../../../proposals/kit";
import { readEnclosing } from "../../../proposals/lens-data";
import { lensStories } from "../../../proposals/lens-kit";

/** pi-lens renders every tool as the shipped relation map. */
export default {
  title: "Chat/Tools/Extensions/pi-lens/read_enclosing",
  ...phaseControls,
};
export const Default = lensStories(readEnclosing, {}).Default;
