import { expect, test } from "bun:test";
import type { UIRequest } from "../shared/extension-ui";
import { focusedRequest, foregroundRequests, uiKey } from "./ui-request-state";

const a: UIRequest = {
  hostId: "h",
  sessionId: "a",
  epoch: 1,
  uiId: "trust",
  kind: "project-trust",
  title: "Trust A",
  cwd: "a",
  fingerprint: "fp",
  resources: [],
};
const b: UIRequest = {
  hostId: "h",
  sessionId: "b",
  epoch: 2,
  uiId: "confirm",
  kind: "confirm",
  title: "Confirm B",
  message: "Allow?",
};
const child: UIRequest = {
  ...a,
  uiId: "child",
  parentUiId: a.uiId,
  kind: "input",
  title: "Child",
};
const view = {
  page: "chat",
  active: "b",
  snapshots: { a: { ready: false as const }, b: {} },
};

test("a background startup prompt never steals focus, including after leaving chat", () => {
  expect(foregroundRequests([a], view)).toEqual([]);
  expect(foregroundRequests([a], { ...view, active: "a" })).toEqual([a]);
  expect(
    foregroundRequests([a], { ...view, page: "settings", active: "a" }),
  ).toEqual([]);
  expect(
    foregroundRequests([a], { ...view, active: undefined, openingAddress: a }),
  ).toEqual([a]);
});

test("an explicit startup selection retains same-owner child priority and does not imply approval", () => {
  const requests = [a, b, child];
  const selected = foregroundRequests(requests, view, uiKey(a));
  expect(selected).toEqual(requests);
  expect(focusedRequest(selected, uiKey(a))).toBe(child);
  expect(a.kind).toBe("project-trust");
  expect(focusedRequest(foregroundRequests(requests, view))).toBe(b);
});

test("normal runtime permission dialogs retain their existing foreground behavior", () => {
  expect(foregroundRequests([b], { ...view, page: "settings" })).toEqual([b]);
});
