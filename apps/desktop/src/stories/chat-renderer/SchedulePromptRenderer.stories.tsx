import type { Meta } from "@storybook/react-vite";
import { SchedulePromptRenderer } from "../../mainview/AgentToolRenderers";
import { scheduleAdd, scheduleList } from "./agent-data";
import { ToolSpecimen } from "./ToolSpecimen";
import { atPhase } from "./tool-fixture";

export default {
  title: "ChatRenderer/Extensions/SchedulePromptRenderer",
  component: SchedulePromptRenderer,
  parameters: { gallery: true },
} satisfies Meta<typeof SchedulePromptRenderer>;

export const States = {
  name: "SchedulePromptRenderer",
  render: () => (
    <ToolSpecimen
      title="SchedulePromptRenderer"
      intro="プロンプトの実行予約と、登録済みの予約一覧を表示します。"
      example={scheduleAdd.tool}
      renderer={SchedulePromptRenderer}
      variants={[
        { label: "登録済みの予約", tool: scheduleList.tool },
        { label: "登録中", tool: atPhase(scheduleAdd, "running") },
        { label: "登録失敗", tool: atPhase(scheduleAdd, "error") },
      ]}
    />
  ),
};
