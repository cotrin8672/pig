import { CodexAgentRenderer } from "../../../../mainview/AgentToolRenderers";
import {
  interruptAgent,
  listAgents,
  readAgentResponse,
  sendMessage,
  spawnAgent,
  waitAgent,
  waitAllAgents,
} from "../../../proposals/codex-agent-data";
import {
  atPhase,
  type Phase,
  phaseControls,
  type ToolFixture,
} from "../../../proposals/kit";

/** pi-codex-subagents の spawn_agent 等。1ツール1行、子の結果はレーン表示（本番）。 */
const none = () => null;
export default {
  title: "Chat/Tools/Extensions/pi-codex-subagents/agents",
  ...phaseControls,
};
type Args = { phase: Phase };
const story = (fixture: ToolFixture, name: string) => ({
  name,
  render: ({ phase }: Args) => (
    <CodexAgentRenderer DefaultRenderer={none} data={atPhase(fixture, phase)} />
  ),
});
export const SpawnAgent = story(spawnAgent, "spawn_agent");
export const WaitAgent = story(waitAgent, "wait_agent");
export const WaitAllAgents = story(waitAllAgents, "wait_all_agents（1件失敗）");
export const ListAgents = story(listAgents, "list_agents");
export const ReadAgentResponse = story(
  readAgentResponse,
  "read_agent_response",
);
export const SendMessage = story(sendMessage, "send_message");
export const InterruptAgent = story(interruptAgent, "interrupt_agent");
