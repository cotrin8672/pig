import type { Meta } from "@storybook/react-vite";
import { AskUserRenderer } from "../../mainview/AgentToolRenderers";
import { askUser } from "./agent-data";
import { ToolSpecimen } from "./ToolSpecimen";
import { atPhase } from "./tool-fixture";

export default {
  title: "ChatRenderer/Extensions/AskUserRenderer",
  component: AskUserRenderer,
  parameters: { gallery: true },
} satisfies Meta<typeof AskUserRenderer>;

export const States = {
  name: "AskUserRenderer",
  render: () => (
    <ToolSpecimen
      title="AskUserRenderer"
      intro="エージェントからの質問と、ユーザーが選んだ回答を表示します。"
      example={askUser.tool}
      renderer={AskUserRenderer}
      variants={[
        { label: "回答待ち", tool: atPhase(askUser, "running") },
        { label: "回答の取り消し", tool: atPhase(askUser, "error") },
      ]}
    />
  ),
};
