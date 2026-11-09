import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT, withCancel } from "@earendil-works/chord/context";
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  InMemoryCredentialStore,
  InMemoryModelsStore,
  registerSessionResourceCleanup,
} from "@earendil-works/pi-ai";
import {
  AssistantEntry,
  createRegistry,
  Harness,
} from "@earendil-works/pi-durable";
import { openDurableStorage } from "../src/bun/durable-storage";

/** Real native Harness, in this Bun process; no desktop/user configuration loaded. */
export async function runNativeSmoke() {
  const root = await mkdtemp(
    join(process.env.PI_SCRATCH_DIR ?? tmpdir(), "pig-durable-smoke-"),
  );
  const models = createModels({
    credentials: new InMemoryCredentialStore(),
    modelsStore: new InMemoryModelsStore(),
    authContext: { env: async () => undefined, fileExists: async () => false },
  });
  const faux = fauxProvider({ tokensPerSecond: Infinity });
  models.setProvider(faux.provider);
  const model = faux.getModel();
  const usedSessions = new Set<string>();
  const releasedSessions: string[] = [];
  const unregister = registerSessionResourceCleanup((id) => {
    if (id && usedSessions.has(id)) releasedSessions.push(id);
  });
  const originalFetch = globalThis.fetch;
  let networkAttempts = 0;
  const denyNetwork = () => {
    networkAttempts++;
    throw new Error("Native smoke must not access the network");
  };
  globalThis.fetch = Object.assign(denyNetwork, { preconnect: denyNetwork });
  const { context, cancel } = withCancel(BACKGROUND_CONTEXT);
  const timeout = setTimeout(
    () => cancel(new Error("Native smoke timed out after 20 seconds")),
    20_000,
  );
  let storage: Awaited<ReturnType<typeof openDurableStorage>> | undefined;
  let harness: Harness | undefined;
  try {
    storage = await openDurableStorage({
      dataRoot: root,
      workspaceId: "smoke",
    });
    const reports: unknown[] = [];
    harness = await Harness.open(
      storage,
      {
        models,
        registry: createRegistry(),
        settings: { extensions: [], retry: { maxRetries: 0 } },
        env: () => undefined,
        onReport: (report) => reports.push(report),
      },
      context,
    );
    const conversation = await harness.createConversation(
      {
        ownership: { kind: "ownerless" },
        agent: {
          model: { provider: model.provider, modelId: model.id },
          tools: [],
          extensions: [],
        },
      },
      context,
    );
    assert.deepEqual((await conversation.agent(context)).tools, []);
    faux.setResponses([
      (_input, options) => {
        assert(options?.sessionId, "Missing native provider session identity");
        usedSessions.add(options.sessionId);
        return fauxAssistantMessage("Durable smoke OK");
      },
    ]);
    const submission = await conversation.submit(
      {
        type: "input",
        content: "Smoke",
        requestId: "durable-smoke",
        whenBusy: "reject",
      },
      context,
    );
    assert(submission.id > 0, "Missing accepted native submission");
    const accepted = await submission.status(context);
    assert.equal(accepted.requestId, "durable-smoke");
    assert.equal(accepted.conversationId, conversation.id);
    assert.equal((await submission.wait(context)).status, "done");
    await conversation.waitForIdle(context);
    const entries = await conversation.entries({}, 100, undefined, context);
    assert(
      entries.items.some(
        (entry) =>
          AssistantEntry.is(entry) &&
          entry.model?.some(
            (message) =>
              message.role === "assistant" &&
              message.stopReason === "stop" &&
              message.content.some(
                (part) =>
                  part.type === "text" && part.text === "Durable smoke OK",
              ),
          ),
      ),
      "Missing settled native assistant output",
    );
    assert.deepEqual(
      reports,
      [],
      "Native Harness reported a background failure",
    );
    await harness.close(BACKGROUND_CONTEXT);
    harness = undefined;
    storage = undefined; // Harness.close owns Storage.close.
    assert.equal(usedSessions.size, 1);
    assert.deepEqual(
      releasedSessions,
      [...usedSessions],
      "Provider resource cleanup must run once",
    );
    // A second open proves the app-owned SQLite writer was released, not leaked.
    storage = await openDurableStorage({
      dataRoot: root,
      workspaceId: "smoke",
    });
    await storage.close(BACKGROUND_CONTEXT);
    storage = undefined;
    assert.equal(networkAttempts, 0);
  } finally {
    clearTimeout(timeout);
    cancel();
    try {
      if (harness) await harness.close(BACKGROUND_CONTEXT);
      else if (storage) await storage.close(BACKGROUND_CONTEXT);
    } finally {
      unregister();
      models.clearProviders();
      globalThis.fetch = originalFetch;
      await rm(root, { recursive: true, force: true });
    }
  }
  console.log(
    `Durable smoke OK (Bun ${Bun.version}); native acceptance/output/cleanup, no login, network, project execution or persistent storage.`,
  );
}

if (import.meta.main) await runNativeSmoke();
