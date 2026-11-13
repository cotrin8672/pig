import { expect, test } from "bun:test";
import { parse } from "@babel/parser";
import type { DesktopState } from "../shared/desktop-state";
import type { Snapshot } from "../shared/rpc-schema";
import type { RuntimeEvent } from "../shared/runtime-contract";
import type { RuntimeWireEvent } from "../shared/snapshot-delta";
import { emptyTranscript } from "../shared/transcript";
import { createCompletionTracker } from "./notifications";
import { createRuntimeDeltaEncoder } from "./snapshot-delta";

test("desktop runtime delivery sends one transcript and clears completion only when needed", async () => {
  // Exercise the actual entrypoint callback without starting Electrobun or touching user state.
  const source = await Bun.file(new URL("./index.ts", import.meta.url)).text();
  const call = parse(source, {
    sourceType: "module",
    plugins: ["typescript"],
  }).program.body.find(
    (node) =>
      node.type === "ExpressionStatement" &&
      node.expression.type === "CallExpression" &&
      node.expression.callee.type === "Identifier" &&
      node.expression.callee.name === "configureSessionHost",
  );
  if (
    call?.type !== "ExpressionStatement" ||
    call.expression.type !== "CallExpression"
  )
    throw new Error("Missing SessionHost event wiring");
  const sinks = call.expression.arguments[0];
  if (sinks.type !== "ObjectExpression") throw new Error("Missing event sinks");
  const callback = sinks.properties.find(
    (property) =>
      property.type === "ObjectProperty" &&
      property.key.type === "Identifier" &&
      property.key.name === "runtime",
  );
  if (
    callback?.type !== "ObjectProperty" ||
    callback.value.start == null ||
    callback.value.end == null
  )
    throw new Error("Missing runtime callback");

  const deliveries: RuntimeWireEvent[] = [];
  let legacyDeliveries = 0,
    clears = 0,
    completions = 0,
    notices = 0;
  const desktop: DesktopState = { sessions: {} };
  const trackers = new Map();
  const scope = {
    rpc: {
      send: {
        runtimeEvent: (event: RuntimeWireEvent) => deliveries.push(event),
        sessionEvent: () => legacyDeliveries++,
        notification: () => notices++,
      },
    },
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
    completions: trackers,
    createCompletionTracker,
    encodeRuntimeEvent: createRuntimeDeltaEncoder(),
    report: (error: unknown) => {
      throw error;
    },
    settings: { language: "en" },
    dictionary: () => ({ "Agent finished": "Finished" }),
    windowFocused: true,
    window: { isMinimized: () => false },
  };
  const code = new Bun.Transpiler({ loader: "ts" }).transformSync(
    `const handler = ${source.slice(callback.value.start, callback.value.end)};`,
  );
  const receive = new Function(
    ...Object.keys(scope),
    `${code}\nreturn handler;`,
  )(...Object.values(scope)) as (event: RuntimeEvent) => void;
  const snapshot: Snapshot = {
    address: { hostId: "host", sessionId: "chat", epoch: 1 },
    snapshotSeq: 1,
    info: { id: "chat", cwd: "fixture", title: "Chat", modified: 1 },
    transcript: { ...emptyTranscript(), running: true },
    effort: "off",
    effortLevels: [],
    sessionUI: {
      generation: "fixture",
      views: [],
      commands: [],
      keymaps: [],
      diagnostics: [],
    },
    configError: "fixture config error",
  };
  for (let i = 0; i < 100; i++) receive({ type: "snapshot", snapshot });
  expect(deliveries).toHaveLength(100);
  expect(deliveries[0]).toMatchObject({ type: "snapshot", snapshot });
  expect(legacyDeliveries).toBe(0);
  expect(clears).toBe(1);
  desktop.sessions.chat.completion = { id: "late", outcome: "success" };
  receive({ type: "snapshot", snapshot });
  expect(clears).toBe(2);
  snapshot.transcript = { ...snapshot.transcript, running: false };
  receive({ type: "snapshot", snapshot });
  receive({ type: "snapshot", snapshot });
  expect(completions).toBe(1);
  expect(notices).toBe(1);
  receive({ type: "closed", address: snapshot.address, reason: "close" });
  expect(trackers.size).toBe(0);
});
