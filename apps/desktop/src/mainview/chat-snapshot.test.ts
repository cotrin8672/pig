import { expect, test } from "bun:test";
import type { CompactionFailure, RunFailure } from "@earendil-works/pi-durable";
import { emptyTranscript } from "../shared/transcript";
import {
  applyChatEvent,
  type ChatSnapshot,
  hydrateChatSnapshot,
} from "./chat-snapshot";

const snapshot = (): ChatSnapshot => ({
  info: { id: "1", cwd: "/project", title: "Chat", modified: 1 },
  transcript: emptyTranscript(),
  effort: "off",
  effortLevels: ["off"],
});

test("failure events retain actionable details without an assistant message", () => {
  const next = applyChatEvent(snapshot(), {
    type: "snapshot",
    transcript: emptyTranscript(),
    failure: "No model configured",
  });
  expect(next.failure).toBe("No model configured");
  expect(next.transcript.turns).toHaveLength(0);
});

test("abort events are distinct from failures", () => {
  const next = applyChatEvent(snapshot(), {
    type: "snapshot",
    transcript: emptyTranscript(),
    aborted: true,
  });
  expect(next.aborted).toBe(true);
  expect(next.failure).toBeUndefined();
});

test("a new authoritative event clears stale failure and abort state", () => {
  const next = applyChatEvent(
    { ...snapshot(), failure: "Old error", aborted: true },
    { type: "snapshot", transcript: { ...emptyTranscript(), running: true } },
  );
  expect(next.failure).toBeUndefined();
  expect(next.aborted).toBeUndefined();
  expect(next.transcript.running).toBe(true);
});

test("session open preserves supplied snapshot failure fields", () => {
  expect(
    hydrateChatSnapshot({ ...snapshot(), failure: "faulted" }).failure,
  ).toBe("faulted");
});

test("session open hydrates durable run failures and aborted runs", () => {
  for (const reason of ["no_model", "faulted", "aborted"] as const) {
    const next = hydrateChatSnapshot({
      ...snapshot(),
      live: {
        runFailure: {
          taskId: 1 as RunFailure["taskId"],
          inputs: [],
          reason,
          detail: "Details",
        },
      },
    });
    expect(next.failure).toBe(reason === "aborted" ? undefined : "Details");
    expect(next.aborted).toBe(reason === "aborted");
  }
});

test("session open hydrates compaction errors and falls back to run reason", () => {
  expect(
    hydrateChatSnapshot({
      ...snapshot(),
      live: {
        compactionFailure: {
          taskId: 1 as CompactionFailure["taskId"],
          trigger: "manual",
          error: "Compaction failed",
        },
      },
    }).failure,
  ).toBe("Compaction failed");
  expect(
    hydrateChatSnapshot({
      ...snapshot(),
      live: {
        runFailure: {
          taskId: 1 as RunFailure["taskId"],
          inputs: [],
          reason: "no_model",
        },
      },
    }).failure,
  ).toBe("no_model");
});
