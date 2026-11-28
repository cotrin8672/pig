import type { Meta } from "@storybook/react-vite";
import { CodexAgentRenderer } from "../../mainview/AgentToolRenderers";
import {
  interruptAgent,
  listAgents,
  readAgentResponse,
  sendMessage,
  spawnAgent,
  waitAgent,
  waitAllAgents,
} from "./codex-agent-data";
import { ToolSpecimen } from "./ToolSpecimen";
import { atPhase } from "./tool-fixture";

export default {
  title: "ChatRenderer/Extensions/CodexAgentRenderer",
  component: CodexAgentRenderer,
  parameters: { gallery: true },
} satisfies Meta<typeof CodexAgentRenderer>;

export const States = {
  name: "CodexAgentRenderer",
  render: () => (
    <ToolSpecimen
      title="CodexAgentRenderer"
      intro="Codex サブエージェントへの指示・状態と、子エージェントからの結果を表示します。"
      example={spawnAgent.tool}
      renderer={CodexAgentRenderer}
      variants={[
        { label: "1件の結果を待つ", tool: waitAgent.tool },
        { label: "複数の結果を待つ", tool: waitAllAgents.tool },
        { label: "実行一覧", tool: listAgents.tool },
        { label: "結果の読み取り", tool: readAgentResponse.tool },
        { label: "指示の追加", tool: sendMessage.tool },
        { label: "実行の中断", tool: interruptAgent.tool },
        { label: "起動失敗", tool: atPhase(spawnAgent, "error") },
      ]}
    />
  ),
};
