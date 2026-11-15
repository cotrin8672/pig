import { codexSearch } from "../../../proposals/codex-data";
import { codexSearchProposals } from "../../../proposals/codex-tools";
import { phaseControls } from "../../../proposals/kit";
import { Builtin, lensStories } from "../../../proposals/lens-kit";

export default {
  title: "Chat/Tools/Extensions/pi-codex-search/codex_search",
  ...phaseControls,
};
const stories = lensStories(codexSearch, codexSearchProposals, Builtin);
export const Default = stories.Default;
export const Compare = stories.Compare;
export const Answer = stories.Answer;
export const Sources = stories.Sources;
export const Tabs = stories.Tabs;
export const Compact = stories.Compact;
export const Steps = stories.Steps;
