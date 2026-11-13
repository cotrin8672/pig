import { expect, test } from "bun:test";
import { emptyTranscript } from "../shared/transcript";
import { receiveRuntime, receiveWire } from "./runtime-events";
import { useStore } from "./store";

test("background snapshots commit once, and duplicate publications never notify subscribers", () => {
  const initial = useStore.getState();
  const snapshot = {
    address: { hostId: "state-perf", sessionId: "state-perf", epoch: 1 },
    snapshotSeq: 1,
    info: { id: "state-perf", cwd: "fixture", title: "Fixture", modified: 0 },
    effort: "off" as const,
    effortLevels: [],
    transcript: emptyTranscript(),
  };
  useStore.setState(
    { ...initial, hostId: undefined, addresses: {}, snapshots: {} },
    true,
  );
  receiveRuntime({ type: "ready", snapshot });
  let notifications = 0;
  const stop = useStore.subscribe(() => notifications++);
  try {
    for (let i = 0; i < 100; i++)
      receiveRuntime({
        type: "snapshot",
        snapshot: { ...snapshot, snapshotSeq: i + 2 },
      });
    expect(notifications).toBe(100);
    notifications = 0;
    receiveRuntime({ type: "snapshot", snapshot });
    receiveWire({
      type: "snapshot",
      address: snapshot.address,
      snapshotSeq: 1,
      transcript: snapshot.transcript,
    });
    expect(notifications).toBe(0);
  } finally {
    stop();
    useStore.setState(initial, true);
  }
});
