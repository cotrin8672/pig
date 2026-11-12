export type ResponseErrorKind =
  | "stopped"
  | "rate_limit"
  | "quota"
  | "authentication"
  | "permission"
  | "context"
  | "unavailable"
  | "network"
  | "invalid_request"
  | "unknown";

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/** Provider errors can be plain text, JSON, or an HTTP status followed by JSON. */
export function responseErrorKind(
  message: string,
  stopReason?: string,
): ResponseErrorKind {
  if (stopReason === "aborted") return "stopped";
  let payload: Record<string, unknown> = {};
  const start = message.indexOf("{");
  if (start >= 0) {
    try {
      payload = object(JSON.parse(message.slice(start)));
    } catch {
      // Non-JSON errors still use their plain-text message below.
    }
  }
  const error = object(payload.error);
  const status = Number(
    payload.status ??
      payload.status_code ??
      error.status ??
      message.match(/^\s*(?:Error:\s*)?(?:HTTP\s+)?([45]\d{2})\b/i)?.[1],
  );
  const text = [error.type, error.code, error.message, payload.code, message]
    .filter((value) => typeof value === "string")
    .join(" ");
  if (
    /insufficient[_ ]quota|quota[_ ]exceeded|billing|credit balance|usage limit|spending limit/i.test(
      text,
    )
  )
    return "quota";
  if (status === 429 || /rate[_ -]?limit|too many requests/i.test(text))
    return "rate_limit";
  if (
    status === 401 ||
    /authentication_error|invalid[_ -]?api[_ -]?key|unauthorized|expired token/i.test(
      text,
    )
  )
    return "authentication";
  if (
    status === 403 ||
    /permission[_ -]?(?:error|denied)|forbidden/i.test(text)
  )
    return "permission";
  if (
    /context[_ -]?(?:length|window)|prompt is too long|too many tokens|maximum context|request_too_large|request too large/i.test(
      text,
    ) ||
    status === 413
  )
    return "context";
  if (
    status >= 500 ||
    /overloaded|api_error|server_error|service unavailable/i.test(text)
  )
    return "unavailable";
  if (
    /ECONN\w*|ENOTFOUND|ETIMEDOUT|fetch failed|failed to fetch|network|timed?\s*out|timeout|connection (?:error|closed|reset)/i.test(
      text,
    )
  )
    return "network";
  if (
    status === 400 ||
    status === 404 ||
    /invalid_request|not_found_error|model.*not found/i.test(text)
  )
    return "invalid_request";
  return "unknown";
}
