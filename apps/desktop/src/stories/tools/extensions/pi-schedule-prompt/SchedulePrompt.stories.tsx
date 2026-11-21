import { SchedulePromptRenderer } from "../../../../mainview/AgentToolRenderers";
import { scheduleAdd, scheduleList } from "../../../proposals/agent-data";
import { atPhase, type Phase, phaseControls } from "../../../proposals/kit";

/** pi-schedule-prompt の schedule_prompt ツール。通常のツール行（本番）。 */
const none = () => null;
export default {
  title: "Chat/Tools/Extensions/pi-schedule-prompt/schedule_prompt",
  ...phaseControls,
};
type Args = { phase: Phase };
export const Default = {
  render: ({ phase }: Args) => (
    <SchedulePromptRenderer
      DefaultRenderer={none}
      data={atPhase(scheduleAdd, phase)}
    />
  ),
};
export const List = {
  name: "action: list",
  render: ({ phase }: Args) => (
    <SchedulePromptRenderer
      DefaultRenderer={none}
      data={atPhase(scheduleList, phase)}
    />
  ),
};
