import { phaseControls } from "../../../proposals/kit";
import { lensDiagnostics } from "../../../proposals/lens-data";
import { lensStories } from "../../../proposals/lens-kit";

/** pi-lens renders every tool as the shipped relation map. */
export default {
  title: "Chat/Tools/Extensions/pi-lens/lens_diagnostics",
  ...phaseControls,
};
export const Default = lensStories(lensDiagnostics, {}).Default;
