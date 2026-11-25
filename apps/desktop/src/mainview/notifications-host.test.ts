import { expect, test } from "bun:test";
import { emptyTranscript } from "../shared/transcript";
import { receiveNoticeHistory, useStore } from "./store";

test("a host completion for the chat on screen never renders as unread", () => {
  const original = useStore.getState();
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { visibilityState: "visible", hasFocus: () => true },
  });
  useStore.setState({
    active: "chat",
    page: "chat",
    opening: false,
    pendingUI: [],
    snapshots: {
      chat: {
        address: { hostId: "host", sessionId: "chat", epoch: 1 },
        snapshotSeq: 1,
        info: { id: "chat", cwd: "project", title: "Chat", modified: 1 },
        transcript: emptyTranscript(),
        effort: "off",
        effortLevels: [],
      },
    },
  });
  const unread = () =>
    useStore.getState().noticeHistory.filter((n) => !n.read).length;
  const record = {
    id: "done",
    createdAt: 1,
    read: false,
    kind: "completion" as const,
    level: "success" as const,
    message: "Done",
    session: { id: "chat", cwd: "project" },
  };
  receiveNoticeHistory({ revision: 1, notices: [record] });
  expect(unread()).toBe(0);
  Reflect.deleteProperty(globalThis, "document");
  useStore.setState(original, true);
});
