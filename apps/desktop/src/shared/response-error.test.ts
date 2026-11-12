import { expect, test } from "bun:test";
import { responseErrorKind } from "./response-error";

const rateLimitError =
  '429 {"type":"error","error":{"type":"rate_limit_error","message":"This request would exceed your account\'s rate limit. Please try again later."},"request_id":"req_011CgxekYHk9gv27caWbvkP5"}';

test("classifies provider error envelopes and plain text without exposing raw JSON as the explanation", () => {
  for (const [message, kind] of [
    [rateLimitError, "rate_limit"],
    ['{"error":{"type":"rate_limit_error"}}', "rate_limit"],
    ['429 {"error":{"code":"insufficient_quota"}}', "quota"],
    ["Your credit balance is too low", "quota"],
    ["HTTP 401 Unauthorized", "authentication"],
    ['{"status":401,"error":null}', "authentication"],
    ["403 access denied", "permission"],
    ["400 prompt is too long", "context"],
    ['{"error":{"code":"context_length_exceeded"}}', "context"],
    ["413 request too large", "context"],
    ["529 overloaded", "unavailable"],
    ["Error: 503", "unavailable"],
    ["fetch failed: ECONNRESET", "network"],
    ["Request timed out", "network"],
    ["404 model missing", "invalid_request"],
    ["400 invalid request", "invalid_request"],
    ["Unexpected failure {invalid json", "unknown"],
    ['{"error":[]}', "unknown"],
    ["", "unknown"],
  ] as const) {
    expect(responseErrorKind(message), message).toBe(kind);
  }
  expect(responseErrorKind(rateLimitError, "aborted")).toBe("stopped");
});
