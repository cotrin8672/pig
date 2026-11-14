import { expect, test } from "bun:test";
import type { DesktopState } from "../shared/desktop-state";
import type { Snapshot } from "../shared/rpc-schema";
import { emptyTranscript } from "../shared/transcript";
import { createCompletionNotifier } from "./completion-notifier";

test("completion notifier clears completion only when needed and notifies once", () => {
  let clears = 0,
    completions = 0,
    notices = 0,
    system = 0,
    attended = true;
  const desktop: DesktopState = { sessions: {} };
  const receive = createCompletionNotifier({
    desktopState: {
      value: desktop,
      clearCompletion: () => {
        clears++;
        desktop.sessions.chat = { pinned: true };
        return Promise.resolve();
      },
      completeSession: () => {
        completions++;
        return Promise.resolve();
      },
    },
    language: () => "en",
    report: (error) => {
      throw error;
    },
    notify: () => notices++,
    attended: () => attended,
    showSystemNotification: () => system++,
  });
  const snapshot: Snapshot = {
    address: { hostId: "host", sessionId: "chat", epoch: 1 },
    snapshotSeq: 1,
    info: { id: "chat", cwd: "fixture", title: "Chat", modified: 1 },
    transcript: { ...emptyTranscript(), running: true },
    effort: "off",
    effortLevels: [],
  };
  for (let i = 0; i < 100; i++) receive({ type: "snapshot", snapshot });
  expect(clears).toBe(1);
  desktop.sessions.chat.completion = { id: "late", outcome: "success" };
  receive({ type: "snapshot", snapshot });
  expect(clears).toBe(2);
  snapshot.transcript = { ...snapshot.transcript, running: false };
  receive({ type: "snapshot", snapshot });
  receive({ type: "snapshot", snapshot });
  expect(completions).toBe(1);
  expect(notices).toBe(1);
  expect(system).toBe(0);
  attended = false;
  snapshot.transcript = { ...snapshot.transcript, running: true };
  receive({ type: "snapshot", snapshot });
  snapshot.transcript = { ...snapshot.transcript, running: false };
  receive({ type: "snapshot", snapshot });
  expect(system).toBe(1);
  receive({ type: "closed", address: snapshot.address, reason: "close" });
  expect(receive.tracked()).toBe(0);
});
