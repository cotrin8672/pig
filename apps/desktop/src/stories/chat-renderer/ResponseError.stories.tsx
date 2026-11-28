import type { Meta } from "@storybook/react-vite";
import { ResponseError } from "../../mainview/ResponseError";
import { PrimitiveSpecimen } from "../design-system/PrimitiveSpecimen";
import { StoryTurn } from "../StoryTurn";

export default {
  title: "ChatRenderer/Activity/ResponseError",
  component: ResponseError,
  parameters: { gallery: true },
} satisfies Meta<typeof ResponseError>;

const draw = (message: string, stopReason = "error") => (
  <StoryTurn>
    <ResponseError message={message} stopReason={stopReason} />
  </StoryTurn>
);

export const States = {
  name: "ResponseError",
  render: () => (
    <PrimitiveSpecimen
      layer="ChatRenderer"
      title="ResponseError"
      intro="応答が止まった理由を表示します。失敗時は元のエラーも確認できます。"
      context="利用上限に達した応答"
      variants={[
        {
          label: "認証エラー",
          sample: draw("401 authentication_error: Invalid API key"),
        },
        { label: "過負荷", sample: draw("529 overloaded_error: Overloaded") },
        {
          label: "その他のエラー",
          sample: draw("An unexpected provider error occurred"),
        },
        { label: "手動で停止", sample: draw("Request aborted", "aborted") },
      ]}
    >
      {draw(
        "429 rate_limit_error: This request would exceed your account's rate limit.",
      )}
    </PrimitiveSpecimen>
  ),
};
