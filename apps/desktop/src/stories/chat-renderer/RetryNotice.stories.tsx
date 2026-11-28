import type { Meta } from "@storybook/react-vite";
import { RetryNotice } from "../../mainview/ResponseError";
import { PrimitiveSpecimen } from "../design-system/PrimitiveSpecimen";
import { StoryTurn } from "../StoryTurn";

export default {
  title: "ChatRenderer/Activity/RetryNotice",
  component: RetryNotice,
  parameters: { gallery: true },
} satisfies Meta<typeof RetryNotice>;

export const States = {
  name: "RetryNotice",
  render: () => (
    <PrimitiveSpecimen
      layer="ChatRenderer"
      title="RetryNotice"
      intro="一時的な障害で SDK が応答を自動再試行する際の状態を表示します。"
      context="次の試行を待機中"
      variants={[
        {
          label: "再試行済み",
          sample: (
            <StoryTurn>
              <RetryNotice attempt={1} message="WebSocket closed 1012" />
            </StoryTurn>
          ),
        },
      ]}
    >
      <StoryTurn>
        <RetryNotice
          attempt={2}
          message="WebSocket closed 1012"
          waiting={{ maxAttempts: 3, retryAt: Date.now() + 8000 }}
        />
      </StoryTurn>
    </PrimitiveSpecimen>
  ),
};
