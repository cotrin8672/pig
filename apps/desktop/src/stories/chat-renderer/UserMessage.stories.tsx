import type { Meta } from "@storybook/react-vite";
import { UserMessage } from "../../mainview/MessageContent";
import { scheduledMarker } from "../../mainview/scheduled-prompt-model";
import { TooltipLayer } from "../../mainview/Tooltip";
import { withAnnotations } from "../../shared/annotations";
import { PrimitiveSpecimen } from "../design-system/PrimitiveSpecimen";
import { StoryTurn } from "../StoryTurn";
import { firedMarker, scheduledPrompt } from "./agent-data";
import { designData } from "./response-data";

export default {
  title: "ChatRenderer/Messages/UserMessage",
  component: UserMessage,
  parameters: { gallery: true },
} satisfies Meta<typeof UserMessage>;

const draw = (entryId: string, content: string, scheduled?: string) => (
  <StoryTurn speaker="user">
    <UserMessage
      sessionId="preview"
      entryId={entryId}
      disabled={false}
      message={{ role: "user", timestamp: Date.UTC(2026, 0, 1, 12), content }}
      scheduled={scheduled}
    />
  </StoryTurn>
);

export const States = {
  name: "UserMessage",
  render: () => (
    <TooltipLayer>
      <PrimitiveSpecimen
        layer="ChatRenderer"
        title="UserMessage"
        intro="送った本文・引用・ファイルをユーザーのメッセージとして表示します。"
        context="ユーザーが送信した本文"
        variants={[
          {
            label: "引用つき",
            sample: draw(
              "annotated",
              withAnnotations(
                "引用した箇所について説明してください。",
                designData.annotations,
              ),
            ),
          },
          {
            label: "予約から送信",
            sample: draw(
              "scheduled",
              scheduledPrompt.prompt,
              scheduledMarker(firedMarker)?.jobName,
            ),
          },
        ]}
      >
        {draw("prompt", designData.request)}
      </PrimitiveSpecimen>
    </TooltipLayer>
  ),
};
