import { imagegen } from "../../../proposals/codex-data";
import { imagegenProposals } from "../../../proposals/codex-tools";
import { phaseControls } from "../../../proposals/kit";
import { Builtin, lensStories } from "../../../proposals/lens-kit";

export default {
  title: "Chat/Tools/Extensions/pi-codex-imagegen/imagegen",
  ...phaseControls,
};
const stories = lensStories(imagegen, imagegenProposals, Builtin);
export const Default = stories.Default;
export const Compare = stories.Compare;
export const Frame = stories.Frame;
export const Dialogue = stories.Dialogue;
export const Thumb = stories.Thumb;
export const Spec = stories.Spec;
export const Reveal = stories.Reveal;
