import type { UIReply, UIRequest } from "../shared/extension-ui";
import type { SessionAddress, UIAddress } from "../shared/runtime-contract";
import { sameAddress } from "./chat-snapshot";

export const uiKey = (a: UIAddress) =>
  JSON.stringify([a.hostId, a.sessionId, a.epoch, a.uiId]);
export function addRequest(
  requests: UIRequest[],
  request: UIRequest,
): UIRequest[] {
  return requests.some((item) => uiKey(item) === uiKey(request))
    ? requests
    : [...requests, request];
}
/** Foreground children of the current owner, never an unrelated session's latest request. */
export function focusedRequest(
  requests: UIRequest[],
  selected?: string,
): UIRequest | undefined {
  let focus =
    requests.find((request) => uiKey(request) === selected) ?? requests[0];
  const seen = new Set<string>();
  while (focus && !seen.has(uiKey(focus))) {
    seen.add(uiKey(focus));
    const parent = focus;
    const child = requests.find(
      (request) =>
        sameAddress(request, parent) &&
        request.parentUiId === parent.uiId &&
        !seen.has(uiKey(request)),
    );
    if (!child) break;
    focus = child;
  }
  return focus;
}
/** Startup prompts wait for their chat instead of taking over another view. */
export function foregroundRequests(
  requests: UIRequest[],
  state: {
    page: string;
    active?: string;
    openingAddress?: SessionAddress;
    snapshots: Record<string, { ready?: false }>;
  },
  selected?: string,
) {
  const explicit = requests.find((request) => uiKey(request) === selected);
  return requests.filter(
    (request) =>
      state.snapshots[request.sessionId]?.ready !== false ||
      (explicit && sameAddress(explicit, request)) ||
      (state.page === "chat" &&
        (state.active === request.sessionId ||
          (state.openingAddress &&
            sameAddress(state.openingAddress, request)))),
  );
}

export function validReply(request: UIRequest, reply: UIReply): boolean {
  if (uiKey(request) !== uiKey(reply)) return false;
  if (reply.kind === "cancel") return true;
  if (request.kind !== reply.kind) return false;
  if (reply.kind === "confirm") return typeof reply.value === "boolean";
  if (reply.kind === "project-trust")
    return ["once", "persist", "safe"].includes(reply.value);
  if (
    typeof reply.value !== "string" ||
    new TextEncoder().encode(reply.value).length > 1024 * 1024
  )
    return false;
  return request.kind !== "select" || request.options.includes(reply.value);
}
