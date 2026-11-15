import { phaseControls } from "../../../proposals/kit";
import { moduleReport } from "../../../proposals/lens-data";
import { lensStories } from "../../../proposals/lens-kit";
import { moduleReportProposals } from "../../../proposals/lens-read";

export default {
  title: "Chat/Tools/Extensions/pi-lens/module_report",
  ...phaseControls,
};
const stories = lensStories(moduleReport, moduleReportProposals);
export const Default = stories.Default;
export const Compare = stories.Compare;
export const Spec = stories.Spec;
export const Bands = stories.Bands;
export const Health = stories.Health;
export const Callers = stories.Callers;
export const Sentence = stories.Sentence;
