import { ctxIndex } from "../../../proposals/ctx-data";
import { ctxIndexProposals } from "../../../proposals/ctx-tools";
import { phaseControls } from "../../../proposals/kit";
import { Builtin, lensStories } from "../../../proposals/lens-kit";

export default {
  title: "Chat/Tools/Extensions/context-mode/ctx_index",
  ...phaseControls,
};
const stories = lensStories(ctxIndex, ctxIndexProposals, Builtin);
export const Default = stories.Default;
export const Compare = stories.Compare;
export const Card = stories.Card;
export const Grid = stories.Grid;
export const Header = stories.Header;
export const Sentence = stories.Sentence;
export const Steps = stories.Steps;
