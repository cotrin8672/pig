import { ctxBatch } from "../../../proposals/ctx-data";
import { ctxBatchProposals } from "../../../proposals/ctx-tools";
import { phaseControls } from "../../../proposals/kit";
import { Builtin, lensStories } from "../../../proposals/lens-kit";

export default {
  title: "Chat/Tools/Extensions/context-mode/ctx_batch",
  ...phaseControls,
};
const stories = lensStories(ctxBatch, ctxBatchProposals, Builtin);
export const Default = stories.Default;
export const Compare = stories.Compare;
export const Columns = stories.Columns;
export const QA = stories.QA;
export const Transcript = stories.Transcript;
export const Checklist = stories.Checklist;
export const Sentence = stories.Sentence;
