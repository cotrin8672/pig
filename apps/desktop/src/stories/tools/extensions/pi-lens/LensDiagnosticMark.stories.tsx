import { phaseControls } from "../../../proposals/kit";
import { diagnosticMark } from "../../../proposals/lens-data";
import { lensStories } from "../../../proposals/lens-kit";

/** pi-lens renders every tool as the shipped relation map. */
export default {
  title: "Chat/Tools/Extensions/pi-lens/lens_diagnostic_mark",
  ...phaseControls,
};
export const Default = lensStories(diagnosticMark, {}).Default;
