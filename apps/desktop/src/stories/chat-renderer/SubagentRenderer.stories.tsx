import type { Meta } from "@storybook/react-vite";
import { SubagentRenderer } from "../../mainview/AgentToolRenderers";
import { subagentParallel, subagentSingle } from "./agent-data";
import { ToolSpecimen } from "./ToolSpecimen";
import { atPhase } from "./tool-fixture";

export default {
  title: "ChatRenderer/Extensions/SubagentRenderer",
  component: SubagentRenderer,
  parameters: { gallery: true },
} satisfies Meta<typeof SubagentRenderer>;

export const States = {
  name: "SubagentRenderer",
  render: () => (
    <ToolSpecimen
      title="SubagentRenderer"
      intro="サブエージェントごとの担当、使用モデル、実行結果を表示します。"
      example={subagentSingle.tool}
      renderer={SubagentRenderer}
      variants={[
        { label: "複数エージェントの結果", tool: subagentParallel.tool },
        { label: "実行中", tool: atPhase(subagentParallel, "running") },
        { label: "実行失敗", tool: atPhase(subagentSingle, "error") },
      ]}
    />
  ),
};
