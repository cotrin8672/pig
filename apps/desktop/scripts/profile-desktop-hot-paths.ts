// Synthetic, offline, no user sessions/config/credentials are opened or changed.
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import type {
  AgentSession,
  AgentSessionEvent,
  SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { AdapterRuntime } from "../src/bun/adapter-runtime";
import { createAdapterSource } from "../src/bun/adapter-source";
import { ComposerBridge } from "../src/bun/composer-bridge";
import { packTranscript } from "../src/bun/transcript-wire";
import { receiveRuntime } from "../src/mainview/runtime-events";
import { useStore } from "../src/mainview/store";
import { highlightCode } from "../src/mainview/syntax-highlighting";
import { selectProjectActivity } from "../src/mainview/ui-selectors";
import { emptyTranscript } from "../src/shared/transcript";

const address = {
  hostId: "synthetic-profile",
  sessionId: "background",
  epoch: 1,
};
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
const payload = "tool output line\n".repeat(128 * 1024);
const message = fauxAssistantMessage("live");
const transcript = {
  ...emptyTranscript(),
  history: { revision: "branch" },
  running: true,
  current: "live",
  records: [
    {
      id: "saved",
      entryId: "saved",
      branchId: "branch",
      parentId: null,
      order: 0,
      kind: "message" as const,
      message: { role: "user" as const, content: payload, timestamp: 0 },
    },
    {
      id: "live",
      branchId: "branch",
      parentId: "saved",
      order: 1,
      kind: "message" as const,
      message,
    },
  ],
};
const snapshot = {
  address,
  snapshotSeq: 1,
  info: {
    id: address.sessionId,
    cwd: "project-0",
    title: "Synthetic",
    modified: 1,
  },
  effort: "off" as const,
  effortLevels: [],
  transcript,
};
const wire = JSON.stringify({
  type: "snapshot",
  snapshot: { ...snapshot, transcript: packTranscript(transcript) },
});
let parseMs = 0;
for (let i = 0; i < 20; i++) {
  const start = performance.now();
  JSON.parse(wire);
  parseMs += performance.now() - start;
}
console.info(
  "snapshot-wire",
  JSON.stringify({
    bytesPerUpdate: Buffer.byteLength(wire),
    iterations: 20,
    parseMeanMs: parseMs / 20,
    note: "Bun parse only; not measured WebView/IPC throughput",
  }),
);

const initial = useStore.getState();
const projects = Array.from({ length: 20 }, (_, i) => `project-${i}`);
useStore.setState(
  {
    ...initial,
    hostId: address.hostId,
    active: "new-chat",
    bootstrap: { ...initial.bootstrap, projects },
    sessions: Object.fromEntries(
      projects.map((cwd) => [
        cwd,
        Array.from({ length: 500 }, (_, i) => ({
          id: `${cwd}-${i}`,
          cwd,
          title: "Synthetic",
          modified: 0,
        })),
      ]),
    ),
  },
  true,
);
receiveRuntime({ type: "ready", snapshot });
let notifications = 0;
const stop = useStore.subscribe((state) => {
  notifications++;
  for (const cwd of projects) selectProjectActivity(state, cwd);
});
let totalMs = 0;
for (let i = 0; i < 100; i++) {
  const event = JSON.parse(wire);
  event.snapshot.snapshotSeq = i + 2;
  const start = performance.now();
  receiveRuntime(event);
  totalMs += performance.now() - start;
}
stop();
useStore.setState(initial, true);
console.info(
  "background-state",
  JSON.stringify({
    updates: 100,
    projects: 20,
    listedSessions: 10000,
    subscriberNotifications: notifications,
    receiveAndSelectorsMs: totalMs,
    note: "parse excluded; synthetic project subscribers included",
  }),
);

let mirrorBytes = 0,
  mirrorEvents = 0;
const bridge = new ComposerBridge((event) => {
  mirrorEvents++;
  mirrorBytes += bytes(event);
});
const images = Array.from({ length: 8 }, (_, i) => ({
  id: String(i),
  image: {
    type: "image" as const,
    mimeType: "image/png",
    data: "A".repeat(1024 * 1024),
  },
}));
bridge.sync({
  ...address,
  expectedRevision: 0,
  content: { text: "", pastes: [], images },
});
mirrorBytes = mirrorEvents = 0;
const mirrorStart = performance.now();
for (let i = 0; i < 10; i++)
  bridge.sync({
    ...address,
    expectedRevision: i + 1,
    keepImages: true,
    content: { text: String(i), pastes: [], images: [] },
  });
console.info(
  "draft-mirror",
  JSON.stringify({
    textMirrors: 10,
    retainedImageBytes: 8 * 1024 * 1024,
    emittedEvents: mirrorEvents,
    emittedBytes: mirrorBytes,
    msIncludingJSONEncoding: performance.now() - mirrorStart,
  }),
);

let sourceEvent!: (event: AgentSessionEvent) => void;
const entries = [
  {
    type: "message",
    id: "saved",
    parentId: null,
    timestamp: new Date(0).toISOString(),
    message: { role: "user", content: payload, timestamp: 0 },
  },
] as SessionEntry[];
const session = {
  isStreaming: true,
  sessionManager: {
    getSessionId: () => "synthetic",
    getCwd: () => "synthetic",
    getLeafId: () => entries.at(-1)?.id ?? null,
    getEntryCount: () => entries.length,
    getBranch: () => entries,
    getEntries: () => entries,
  },
  subscribe: (listener: typeof sourceEvent) => {
    sourceEvent = listener;
    return () => {};
  },
} as unknown as AgentSession;
const source = createAdapterSource(
  session,
  { on: () => () => {}, emit() {} },
  () => {},
);
let adapterReads = 0;
const adapters = new AdapterRuntime(
  {
    apiVersion: 1,
    sessionAdapters: [
      {
        id: "synthetic-reader",
        connect(ctx) {
          return ctx.sources.subscribe(() => {
            ctx.sources.entries("branch");
            adapterReads++;
          });
        },
      },
    ],
  },
  source.backend,
  () => {},
);
adapters.start();
await Bun.sleep(0);
adapterReads = 0;
const adapterStart = performance.now();
for (let i = 0; i < 100; i++) {
  sourceEvent({ type: "message_update", message } as AgentSessionEvent);
  await Promise.resolve();
}
console.info(
  "adapter-invalidations",
  JSON.stringify({
    textEvents: 100,
    persistedPayloadBytes: payload.length,
    fullHistoryReads: adapterReads,
    ms: performance.now() - adapterStart,
  }),
);
adapters.dispose();
source.dispose();

let previousTick = performance.now(),
  largestGap = 0;
const heartbeat = setInterval(() => {
  const now = performance.now();
  largestGap = Math.max(largestGap, now - previousTick);
  previousTick = now;
}, 1);
const code =
  "export const value = <span data-test='fixture'>content</span>;\n".repeat(
    1000,
  );
const highlights: unknown[] = [];
for (const suffix of ["", "// changed once", "// changed twice"]) {
  largestGap = 0;
  previousTick = performance.now();
  const start = performance.now();
  await highlightCode(code + suffix, "tsx");
  const ms = performance.now() - start;
  await Bun.sleep(5);
  highlights.push({
    characters: code.length + suffix.length,
    ms,
    largestEventLoopGapMs: largestGap,
  });
}
clearInterval(heartbeat);
console.info(
  "synchronous-highlighting",
  JSON.stringify({
    measurements: highlights,
    note: "same JS tokenizer as renderer; Bun timing, no DOM and no WebView trace",
  }),
);
for (const [kind, text] of [
  [
    "table",
    "| A | B | C |\n| --- | --- | --- |\n" +
      "| value | other | last |\n".repeat(500),
  ],
  ["math", "$$ x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a} $$\n\n".repeat(100)],
]) {
  const start = performance.now();
  const output = renderToStaticMarkup(
    createElement(
      ReactMarkdown,
      {
        remarkPlugins: [remarkGfm, remarkMath],
        rehypePlugins: [[rehypeKatex, { throwOnError: false }]],
      },
      text,
    ),
  );
  console.info(
    "markdown-pipeline",
    JSON.stringify({
      kind,
      characters: text.length,
      outputBytes: Buffer.byteLength(output),
      synchronousMs: performance.now() - start,
      note: "server-render parser/KaTeX CPU; no DOM or browser layout",
    }),
  );
}
