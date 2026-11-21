import { SubagentRenderer } from "../../../../mainview/AgentToolRenderers";
import {
  subagentParallel,
  subagentSingle,
} from "../../../proposals/agent-data";
import { atPhase, type Phase, phaseControls } from "../../../proposals/kit";

/** pi-subagents の subagent ツール。1行1エージェントのレーン表示（本番）。 */
const none = () => null;
export default {
  title: "Chat/Tools/Extensions/pi-subagents/subagent",
  ...phaseControls,
};
type Args = { phase: Phase };
export const Default = {
  render: ({ phase }: Args) => (
    <SubagentRenderer
      DefaultRenderer={none}
      data={atPhase(subagentSingle, phase)}
    />
  ),
};
export const Parallel = {
  name: "並列実行（1件失敗）",
  render: ({ phase }: Args) => (
    <SubagentRenderer
      DefaultRenderer={none}
      data={atPhase(subagentParallel, phase)}
    />
  ),
};
