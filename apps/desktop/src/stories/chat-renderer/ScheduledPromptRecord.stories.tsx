import type { Meta } from "@storybook/react-vite";
import { ScheduledPromptRecord } from "../../mainview/ScheduledPrompt";
import type { TranscriptRecord } from "../../shared/transcript";
import { PrimitiveSpecimen } from "../design-system/PrimitiveSpecimen";
import { subagentDoneMarker, subagentStartMarker } from "./agent-data";

export default {
  title: "ChatRenderer/Extensions/ScheduledPromptRecord",
  component: ScheduledPromptRecord,
  parameters: { gallery: true },
} satisfies Meta<typeof ScheduledPromptRecord>;

const draw = (raw: TranscriptRecord) => (
  <ScheduledPromptRecord
    data={{ id: raw.id, customType: "scheduled_prompt", content: [], raw }}
    DefaultRenderer={() => null}
  />
);

export const States = {
  name: "ScheduledPromptRecord",
  render: () => (
    <PrimitiveSpecimen
      layer="ChatRenderer"
      title="ScheduledPromptRecord"
      intro="別セッションで予約プロンプトが起動・完了した記録を表示します。"
      context="別セッションから届いた結果"
      variants={[
        { label: "予約プロンプトの起動", sample: draw(subagentStartMarker) },
      ]}
    >
      {draw(subagentDoneMarker)}
    </PrimitiveSpecimen>
  ),
};
