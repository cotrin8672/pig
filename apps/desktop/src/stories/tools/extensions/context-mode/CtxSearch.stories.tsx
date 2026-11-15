import { ctxSearch } from "../../../proposals/ctx-data";
import { ctxSearchProposals } from "../../../proposals/ctx-tools";
import { phaseControls } from "../../../proposals/kit";
import { Builtin, lensStories } from "../../../proposals/lens-kit";

export default {
  title: "Chat/Tools/Extensions/context-mode/ctx_search",
  ...phaseControls,
};
const stories = lensStories(ctxSearch, ctxSearchProposals, Builtin);
export const Default = stories.Default;
export const Compare = stories.Compare;
export const Cards = stories.Cards;
export const BySource = stories.BySource;
export const Table = stories.Table;
export const Compact = stories.Compact;
export const Best = stories.Best;
