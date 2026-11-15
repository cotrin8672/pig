import { phaseControls } from "../../../proposals/kit";
import { readSymbol } from "../../../proposals/lens-data";
import { lensStories } from "../../../proposals/lens-kit";

/** pi-lens renders every tool as the shipped relation map. */
export default {
  title: "Chat/Tools/Extensions/pi-lens/read_symbol",
  ...phaseControls,
};
export const Default = lensStories(readSymbol, {}).Default;
