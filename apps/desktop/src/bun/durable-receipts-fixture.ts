/** Test-only native Harness fixtures: no app state, provider credentials, filesystem tools or network. */
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels, fauxProvider } from "@earendil-works/pi-ai";
import {
  createRegistry,
  Harness,
  type HarnessOptions,
  MemoryStorage,
  type Storage,
} from "@earendil-works/pi-durable";
import { SqliteStorage } from "@earendil-works/pi-durable/storage/sqlite";
import { openBunSqliteDatabase } from "./bun-sqlite";

export const ctx = BACKGROUND_CONTEXT;

export async function nativeFixture(
  storage: Storage = new MemoryStorage(),
  changes: Partial<HarnessOptions> = {},
) {
  const faux = fauxProvider({ tokensPerSecond: Infinity });
  const models = createModels();
  models.setProvider(faux.provider);
  const registry = createRegistry();
  const options: HarnessOptions = {
    models,
    registry,
    env: () => undefined,
    settings: {
      extensions: [],
      retry: { enabled: false },
      compaction: { enabled: false },
      progress: {
        partialIntervalMs: 0,
        outputIntervalMs: 0,
        persistWithinMs: 0,
      },
    },
    ...changes,
  };
  const harness = await Harness.open(storage, options, ctx);
  const model = {
    provider: faux.getModel().provider,
    modelId: faux.getModel().id,
  };
  const conversation = await harness.createConversation(
    {
      ownership: { kind: "ownerless" },
      agent: { model, extensions: [], tools: [] },
    },
    ctx,
  );
  return {
    faux,
    models,
    registry,
    options,
    harness,
    conversation,
    storage,
    model,
  };
}

export async function sqliteFixture() {
  const scratch = process.env.PI_SCRATCH_DIR;
  if (!scratch)
    throw new Error(
      "PI_SCRATCH_DIR required for isolated native receipt tests",
    );
  const root = await mkdtemp(join(scratch, "durable-receipts-"));
  const open = async () =>
    SqliteStorage.open(await openBunSqliteDatabase(join(root, "test.sqlite")));
  return { open, remove: () => rm(root, { recursive: true, force: true }) };
}

export async function eventually(
  check: () => boolean | Promise<boolean>,
  message = "native state did not arrive",
) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await Bun.sleep(2);
  }
  throw new Error(message);
}
