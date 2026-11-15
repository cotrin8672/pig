import { phaseControls } from "../../../proposals/kit";
import { effectiveConfig } from "../../../proposals/lens-data";
import { effectiveConfigProposals } from "../../../proposals/lens-health";
import { lensStories } from "../../../proposals/lens-kit";

export default {
  title: "Chat/Tools/Extensions/pi-lens/effective_config",
  ...phaseControls,
};
const stories = lensStories(effectiveConfig, effectiveConfigProposals);
export const Default = stories.Default;
export const Compare = stories.Compare;
export const Matrix = stories.Matrix;
export const Why = stories.Why;
export const Layers = stories.Layers;
export const Chips = stories.Chips;
export const Header = stories.Header;
