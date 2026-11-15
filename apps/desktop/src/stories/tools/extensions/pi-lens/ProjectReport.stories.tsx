import { phaseControls } from "../../../proposals/kit";
import { projectReport } from "../../../proposals/lens-data";
import { lensStories } from "../../../proposals/lens-kit";

/** pi-lens renders every tool as the shipped relation map. */
export default {
  title: "Chat/Tools/Extensions/pi-lens/project_report",
  ...phaseControls,
};
export const Default = lensStories(projectReport, {}).Default;
