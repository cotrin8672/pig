// Offline application-payload probe. No user sessions, SDK startup, or UI changes.

import { isDeepStrictEqual } from "node:util";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { createRuntimeDeltaEncoder } from "../src/bun/snapshot-delta";
import { packSnapshot } from "../src/bun/transcript-wire";
import {
  hydrateChatSnapshot,
  newerSnapshot,
} from "../src/mainview/chat-snapshot";
import type { Snapshot } from "../src/shared/rpc-schema";
import { expandSnapshotDelta } from "../src/shared/snapshot-delta";
import {
  emptyTranscript,
  type TranscriptRecord,
} from "../src/shared/transcript";

function decodeWire<T>(text: string): T {
  try {
    return JSON.parse(text) as T;
  } catch (cause) {
    throw new Error("Invalid synthetic JSON packet", { cause });
  }
}
// Deliberately use JSON semantics, including omission of undefined wire fields.
const wireCopy = <T>(value: T): T => decodeWire<T>(JSON.stringify(value));
const cases = [
  {
    name: "saved-payloads",
    saved: 80,
    liveBytes: 1024,
    toolBytes: 0,
    older: 0,
  },
  {
    name: "large-live-answer",
    saved: 80,
    liveBytes: 1024 * 1024,
    toolBytes: 0,
    older: 0,
  },
  {
    name: "large-running-tool",
    saved: 80,
    liveBytes: 1024,
    toolBytes: 1024 * 1024,
    older: 0,
  },
  {
    name: "many-saved-envelopes",
    saved: 2000,
    liveBytes: 1024,
    toolBytes: 0,
    older: 0,
  },
  {
    name: "retained-older-history",
    saved: 80,
    liveBytes: 1024,
    toolBytes: 0,
    older: 10000,
  },
];
for (const fixture of cases) {
  const records: TranscriptRecord[] = [];
  const tools: Snapshot["transcript"]["tools"] = {};
  for (let i = 0; i < fixture.saved; i++) {
    const id = `saved-${i}`,
      toolCallId = `tool-${i}`;
    const content = [
      { type: "text" as const, text: "saved output\n".repeat(1024) },
    ];
    records.push({
      id,
      entryId: id,
      parentId: i
        ? `saved-${i - 1}`
        : fixture.older
          ? `older-${fixture.older - 1}`
          : null,
      branchId: "leaf",
      order: fixture.older + i,
      kind: "message",
      message: {
        role: "toolResult",
        toolCallId,
        toolName: "read",
        content,
        isError: false,
        timestamp: i,
      },
    });
    tools[toolCallId] = { status: "done", result: { content } };
  }
  const base: Snapshot = {
    address: { hostId: "offline-probe", sessionId: "fixture", epoch: 1 },
    snapshotSeq: 1,
    info: { id: "fixture", cwd: "synthetic", title: "Synthetic", modified: 0 },
    effort: "off",
    effortLevels: [],
    transcript: {
      ...emptyTranscript(),
      records,
      tools,
      history: {
        revision: "branch",
        before: fixture.older ? records[0]?.id : undefined,
      },
      running: true,
      current: "live",
    },
  };
  const next = (seq: number): Snapshot => {
    const live = fauxAssistantMessage("live");
    live.content = [
      { type: "text", text: "x".repeat(fixture.liveBytes) + "z".repeat(seq) },
    ];
    if (fixture.toolBytes)
      live.content.push({
        type: "toolCall",
        id: "running",
        name: "bash",
        arguments: { command: "synthetic" },
      });
    return {
      ...base,
      snapshotSeq: seq,
      transcript: {
        ...base.transcript,
        records: [
          ...records,
          {
            id: "live",
            parentId: records.at(-1)?.id ?? null,
            branchId: "leaf",
            order: fixture.older + records.length,
            kind: "message",
            message: live,
          },
        ],
        tools: fixture.toolBytes
          ? {
              ...tools,
              running: {
                status: "running",
                result: {
                  content: [
                    {
                      type: "text",
                      text: "y".repeat(fixture.toolBytes) + "z".repeat(seq),
                    },
                  ],
                },
              },
            }
          : tools,
      },
    };
  };
  const encode = createRuntimeDeltaEncoder(),
    initial = next(1);
  encode({ type: "ready", snapshot: initial });
  let current = hydrateChatSnapshot(wireCopy(packSnapshot(initial)));
  current = {
    ...current,
    transcript: {
      ...current.transcript,
      history: { revision: "branch" },
      records: [
        ...Array.from(
          { length: fixture.older },
          (_, i): TranscriptRecord => ({
            id: `older-${i}`,
            entryId: `older-${i}`,
            parentId: i ? `older-${i - 1}` : null,
            branchId: "leaf",
            order: i,
            kind: "message",
            message: {
              role: "user",
              content: "earlier question",
              timestamp: 0,
            },
          }),
        ),
        ...current.transcript.records,
      ],
    },
  };
  const samples: {
    encode: number;
    stringify: number;
    decode: number;
    restore: number;
    bytes: number;
  }[] = [];
  let fullBytes = 0;
  for (let i = 0; i < 20; i++) {
    const snapshot = next(i + 2),
      before = current;
    let at = performance.now();
    const event = encode({ type: "snapshot", snapshot });
    const encodeMs = performance.now() - at;
    at = performance.now();
    const text = JSON.stringify(event);
    const stringifyMs = performance.now() - at;
    at = performance.now();
    const decoded = decodeWire<typeof event>(text);
    const decodeMs = performance.now() - at;
    at = performance.now();
    let expanded: Snapshot | undefined;
    if (decoded.type === "snapshotDelta")
      expanded = expandSnapshotDelta(decoded, before);
    else if ("snapshot" in decoded)
      expanded = hydrateChatSnapshot(decoded.snapshot);
    if (!expanded) throw new Error("Missing base");
    current = newerSnapshot(before, expanded);
    const restoreMs = performance.now() - at;
    if (current.transcript.records.length !== fixture.older + fixture.saved + 1)
      throw new Error("Retained history was lost during the probe");
    if (i === 0 || i === 19) {
      const full = packSnapshot(snapshot);
      fullBytes = Buffer.byteLength(
        JSON.stringify({ type: "snapshot", snapshot: full }),
      );
      if (
        !isDeepStrictEqual(
          current,
          newerSnapshot(before, hydrateChatSnapshot(wireCopy(full))),
        )
      )
        throw new Error(
          "Delta result differs from the complete snapshot oracle",
        );
    }
    if (i >= 5)
      samples.push({
        encode: encodeMs,
        stringify: stringifyMs,
        decode: decodeMs,
        restore: restoreMs,
        bytes: Buffer.byteLength(text),
      });
  }
  const mean = (key: keyof (typeof samples)[number]) =>
    samples.reduce((sum, sample) => sum + sample[key], 0) / samples.length;
  console.log(
    JSON.stringify({
      name: fixture.name,
      savedRecords: fixture.saved,
      retainedOlderRecords: fixture.older,
      fullBytes,
      deltaBytes: mean("bytes"),
      encodeMeanMs: mean("encode"),
      stringifyMeanMs: mean("stringify"),
      bunJsonDecodeMeanMs: mean("decode"),
      expandShareRetainMeanMs: mean("restore"),
      oracleEqual: true,
      scope:
        "Synthetic Bun application payload only; excludes SDK projection/cloning, outer RPC, Windows JS compilation, React and layout",
    }),
  );
}
