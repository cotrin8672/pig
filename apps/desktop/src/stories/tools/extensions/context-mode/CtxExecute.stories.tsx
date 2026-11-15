import { ctxExecute, ctxExecuteLarge } from "../../../proposals/ctx-data";
import { ctxExecuteProposals } from "../../../proposals/ctx-tools";
import { phaseControls } from "../../../proposals/kit";
import { Builtin, lensStories } from "../../../proposals/lens-kit";

export default {
  title: "Chat/Tools/Extensions/context-mode/ctx_execute",
  ...phaseControls,
};
const stories = lensStories(ctxExecute, ctxExecuteProposals, Builtin);
export const Default = stories.Default;
export const Compare = stories.Compare;
export const Notebook = stories.Notebook;
export const Answer = stories.Answer;
export const Saved = stories.Saved;
export const Terminal = stories.Terminal;
export const Script = stories.Script;

/** intent付きの大きな出力：要約行・一致した部分・検索ハンドルが返る。 */
export const CompareLarge = {
  ...lensStories(ctxExecuteLarge, ctxExecuteProposals, Builtin).Compare,
  name: "Compare all（大きな出力）",
};
