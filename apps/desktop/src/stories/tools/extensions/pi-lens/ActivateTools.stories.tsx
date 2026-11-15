import { phaseControls } from "../../../proposals/kit";
import { activateTools } from "../../../proposals/lens-data";
import { activateProposals } from "../../../proposals/lens-health";
import { lensStories } from "../../../proposals/lens-kit";

export default {
  title: "Chat/Tools/Extensions/pi-lens/pi_lens_activate_tools",
  ...phaseControls,
};
const stories = lensStories(activateTools, activateProposals);
export const Default = stories.Default;
export const Compare = stories.Compare;
export const Toolbox = stories.Toolbox;
export const Diff = stories.Diff;
export const Toast = stories.Toast;
export const HeaderOnly = stories.HeaderOnly;
export const Described = stories.Described;
