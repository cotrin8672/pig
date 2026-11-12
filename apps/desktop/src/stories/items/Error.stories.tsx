import { ResponseError } from "../../mainview/ResponseError";

export default { title: "Chat/Activity/Error" };
export const RateLimit = {
  render: () => (
    <ResponseError
      stopReason="error"
      message={
        '429 {"type":"error","error":{"type":"rate_limit_error","message":"This request would exceed your account\'s rate limit. Please try again later."},"request_id":"req_011CgxekYHk9gv27caWbvkP5"}'
      }
    />
  ),
};
export const Authentication = {
  render: () => (
    <ResponseError message="401 authentication_error: Invalid API key" />
  ),
};
export const Unavailable = {
  render: () => <ResponseError message="529 overloaded_error: Overloaded" />,
};
export const Unknown = {
  render: () => (
    <ResponseError message="An unexpected provider error occurred" />
  ),
};
export const Stopped = {
  render: () => (
    <ResponseError message="Request aborted" stopReason="aborted" />
  ),
};
