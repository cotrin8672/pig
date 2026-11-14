import { RetryNotice } from "../../mainview/ResponseError";

export default { title: "Chat/Activity/Retry" };
export const Waiting = {
  render: () => (
    <RetryNotice
      attempt={2}
      message="WebSocket closed 1012"
      waiting={{ maxAttempts: 3, retryAt: Date.now() + 8000 }}
    />
  ),
};
export const Retried = {
  render: () => <RetryNotice attempt={1} message="WebSocket closed 1012" />,
};
