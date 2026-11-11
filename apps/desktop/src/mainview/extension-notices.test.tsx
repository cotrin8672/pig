import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ExtensionUIEvent } from "../shared/extension-ui";
import { emptyTranscript, type Transcript } from "../shared/transcript";
import {
  alignExtensionNotices,
  appendExtensionNotice,
  ExtensionNoticeLine,
  interleaveExtensionNotices,
} from "./extension-notices";

type Notify = Extract<ExtensionUIEvent, { type: "notify" }>;
const event = (message: string, level: Notify["level"] = "info"): Notify => ({
  type: "notify",
  address: { hostId: "host", sessionId: "chat", epoch: 1 },
  level,
  message,
});
const transcript = (ids: string[]): Transcript => ({
  ...emptyTranscript(),
  history: { revision: "branch" },
  records: ids.map((id, order) => ({
    id,
    order,
    parentId: null,
    branchId: "branch",
    kind: "message",
    message: { role: "user", content: id, timestamp: order },
  })),
});
const messages = (
  state: Transcript,
  notices: Parameters<typeof interleaveExtensionNotices>[1],
) =>
  interleaveExtensionNotices(state, notices).map((item) =>
    "notice" in item ? item.notice.message : item.record.id,
  );

test("consecutive info replaces the same line, but new output and warning/error break coalescing", () => {
  const state = transcript(["first"]);
  let notices = appendExtensionNotice([], event("loading"), state);
  const id = notices[0].id;
  notices = appendExtensionNotice(notices, event("ready"), state);
  expect(notices).toHaveLength(1);
  expect(notices[0].id).toBe(id);
  const next = transcript(["first", "second"]);
  notices = appendExtensionNotice(notices, event("next"), next);
  notices = appendExtensionNotice(notices, event("warning", "warning"), next);
  notices = appendExtensionNotice(notices, event("error", "error"), next);
  notices = appendExtensionNotice(notices, event("after error"), next);
  expect(messages(next, notices)).toEqual([
    "first",
    "ready",
    "second",
    "next",
    "warning",
    "error",
    "after error",
  ]);
});

test("hidden SDK metadata does not interrupt info coalescing", () => {
  const state = transcript(["first"]);
  const notices = appendExtensionNotice([], event("loading"), state);
  state.records.push({
    id: "metadata",
    order: 1,
    parentId: null,
    branchId: "branch",
    kind: "session-entry",
    entryType: "model_change",
    data: {},
  });
  expect(appendExtensionNotice(notices, event("ready"), state)).toMatchObject([
    { message: "ready", after: "first" },
  ]);
});

test("live-to-saved IDs and prepended history preserve inline position and coalescing", () => {
  const notices = appendExtensionNotice(
    [],
    event("loading"),
    transcript(["live"]),
  );
  const saved = {
    ...transcript(["older", "saved"]),
    liveToEntry: { live: "saved" },
  };
  expect(messages(saved, notices)).toEqual(["older", "saved", "loading"]);
  const updated = appendExtensionNotice(notices, event("ready"), saved);
  expect(updated).toHaveLength(1);
  expect(messages(saved, updated)).toEqual(["older", "saved", "ready"]);
});

test("startup notices bind to restored history; another branch discards display-only lines", () => {
  const pending = appendExtensionNotice([], event("starting"));
  const restored = transcript(["history"]);
  const notices = alignExtensionNotices(pending, restored);
  expect(messages(restored, notices)).toEqual(["history", "starting"]);
  expect(alignExtensionNotices(notices, restored)).toBe(notices);
  const next = { ...restored, history: { revision: "another-branch" } };
  expect(alignExtensionNotices(notices, next)).toEqual([]);
  expect(messages(next, notices)).toEqual(["history"]);
  const empty = transcript([]);
  const early = appendExtensionNotice([], event("before chat"), empty);
  expect(messages(transcript(["new"]), early)).toEqual(["before chat", "new"]);
});

test.each([
  "info",
  "warning",
  "error",
] as const)("%s is inert inline text with severity, not a toast", (level) => {
  const [notice] = appendExtensionNotice(
    [],
    event("<img onerror=bad>\nline", level),
  );
  const html = renderToStaticMarkup(<ExtensionNoticeLine notice={notice} />);
  expect(html).toContain(
    `class="extension-notice ${level === "info" ? "muted" : level}"`,
  );
  expect(html).toContain(level === "error" ? 'role="alert"' : 'role="status"');
  expect(html).toContain("&lt;img onerror=bad&gt;\nline");
  expect(html).not.toContain("<img");
  if (level !== "info")
    expect(html).toContain(level === "warning" ? "Warning: " : "Error: ");
});
