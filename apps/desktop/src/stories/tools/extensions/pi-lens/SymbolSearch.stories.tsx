import { phaseControls } from "../../../proposals/kit";
import { symbolSearch } from "../../../proposals/lens-data";
import { lensStories } from "../../../proposals/lens-kit";

/** pi-lens renders every tool as the shipped relation map. */
export default {
  title: "Chat/Tools/Extensions/pi-lens/symbol_search",
  ...phaseControls,
};
export const Default = lensStories(symbolSearch, {}).Default;
