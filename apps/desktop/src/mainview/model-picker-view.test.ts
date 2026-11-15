import { expect, test } from "bun:test";
import type { Snapshot } from "../shared/rpc-schema";
import { emptyTranscript } from "../shared/transcript";
import { createModelPickerSelector } from "./model-picker-view";

function snapshot(): Snapshot {
  return {
    address: { hostId: "fixture", sessionId: "chat", epoch: 1 },
    snapshotSeq: 1,
    info: { id: "chat", cwd: "fixture", title: "Chat", modified: 1 },
    model: { provider: "fixture", id: "model", name: "Model" },
    effort: "off",
    effortLevels: ["off", "high"],
    sessionAccounts: { fixture: "work" },
    modelCatalog: [{ provider: "fixture", id: "model", name: "Model" }],
    transcript: emptyTranscript(),
  };
}

test("100 IPC body updates reuse picker props without reading the catalog or retaining a transcript", () => {
  const select = createModelPickerSelector();
  const initial = snapshot();
  initial.modelCatalog = new Proxy(initial.modelCatalog ?? [], {
    get() {
      throw new Error("Picker selector scanned the catalog");
    },
  });
  const first = select(initial);
  for (let index = 0; index < 100; index++) {
    const next = {
      ...initial,
      snapshotSeq: index + 2,
      address: { ...initial.address },
      model: { ...(initial.model as NonNullable<Snapshot["model"]>) },
      sessionAccounts: { ...initial.sessionAccounts },
      effortLevels: [...initial.effortLevels],
      transcript: { ...emptyTranscript(), running: true },
      contextUsage: { tokens: index, contextWindow: 1000, percent: index / 10 },
    };
    expect(select(next)).toBe(first);
  }
  expect(first).not.toHaveProperty("transcript");
  expect(first).not.toHaveProperty("snapshotSeq");
  expect(first).not.toHaveProperty("contextUsage");
});

test("selection, catalog, account locks, ownership and project changes invalidate picker props", () => {
  const initial = snapshot();
  for (const patch of [
    {
      model: {
        ...(initial.model as NonNullable<Snapshot["model"]>),
        name: "Renamed",
      },
    },
    { effort: "high" as const },
    { effortLevels: ["off"] as Snapshot["effortLevels"] },
    { sessionAccounts: { fixture: "other" } },
    { accountId: "other" },
    { accountSwitchAllowed: false },
    { ready: false as const },
    { address: { ...initial.address, epoch: 2 } },
    { info: { ...initial.info, cwd: "other" } },
    { modelCatalog: structuredClone(initial.modelCatalog) },
  ]) {
    const select = createModelPickerSelector();
    const first = select(initial);
    expect(select({ ...initial, ...patch })).not.toBe(first);
  }
});
