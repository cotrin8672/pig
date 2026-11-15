import { phaseControls } from "../../../proposals/kit";
import { projectReport } from "../../../proposals/lens-data";
import { projectReportProposals } from "../../../proposals/lens-health";
import { lensStories } from "../../../proposals/lens-kit";

export default {
  title: "Chat/Tools/Extensions/pi-lens/project_report",
  ...phaseControls,
};
const stories = lensStories(projectReport, projectReportProposals);
export const Default = stories.Default;
export const Compare = stories.Compare;
export const Layers = stories.Layers;
export const Hotspots = stories.Hotspots;
export const Index = stories.Index;
export const Brief = stories.Brief;
export const Cycle = stories.Cycle;
