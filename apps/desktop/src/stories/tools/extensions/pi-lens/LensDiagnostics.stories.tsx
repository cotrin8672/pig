import { phaseControls } from "../../../proposals/kit";
import { lensDiagnostics } from "../../../proposals/lens-data";
import { diagnosticsProposals } from "../../../proposals/lens-health";
import { lensStories } from "../../../proposals/lens-kit";

export default {
  title: "Chat/Tools/Extensions/pi-lens/lens_diagnostics",
  ...phaseControls,
};
const stories = lensStories(lensDiagnostics, diagnosticsProposals);
export const Default = stories.Default;
export const Compare = stories.Compare;
export const Signal = stories.Signal;
export const Compiler = stories.Compiler;
export const Sources = stories.Sources;
export const Todo = stories.Todo;
export const Donut = stories.Donut;
