import { phaseControls } from "../../../proposals/kit";
import { diagnosticMark } from "../../../proposals/lens-data";
import { diagnosticMarkProposals } from "../../../proposals/lens-health";
import { lensStories } from "../../../proposals/lens-kit";

export default {
  title: "Chat/Tools/Extensions/pi-lens/lens_diagnostic_mark",
  ...phaseControls,
};
const stories = lensStories(diagnosticMark, diagnosticMarkProposals);
export const Default = stories.Default;
export const Compare = stories.Compare;
export const Visibility = stories.Visibility;
export const Note = stories.Note;
export const Timeline = stories.Timeline;
export const Inline = stories.Inline;
export const Receipt = stories.Receipt;
