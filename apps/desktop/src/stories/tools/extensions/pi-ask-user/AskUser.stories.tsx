import { AskUserRenderer } from "../../../../mainview/AgentToolRenderers";
import {
  AskPendingDefault,
  askPendingProposals,
} from "../../../proposals/agent-content";
import { askUser } from "../../../proposals/agent-data";
import {
  atPhase,
  contentStories,
  type Phase,
  phaseControls,
} from "../../../proposals/kit";

/** pi-ask-user の ask_user ツール。質問カード（本番）。 */
const none = () => null;
export default {
  title: "Chat/Tools/Extensions/pi-ask-user/ask_user",
  ...phaseControls,
};
type Args = { phase: Phase };
export const Default = {
  render: ({ phase }: Args) => (
    <AskUserRenderer DefaultRenderer={none} data={atPhase(askUser, phase)} />
  ),
};

/** 回答待ちの間の入力UI（現在はターミナル内のTUI）。デザイン案。 */
const pending = contentStories(askPendingProposals, AskPendingDefault);
export const PendingCompare = {
  ...pending.Compare,
  name: "回答待ち · Compare all",
};
export const PendingDialog = {
  ...pending.Dialog,
  name: "回答待ち · ネイティブ質問ダイアログ",
};
