import { expect, test } from "bun:test";
import {
  fauxAssistantMessage,
  fauxProvider,
  InMemoryCredentialStore,
  InMemoryModelsStore,
} from "@earendil-works/pi-ai";
import { projectedContextUsage } from "./context-usage";
import {
  createAgentSessionFromServices,
  createAgentSessionServices,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "./sdk";

test("SDK context projection uses valid response usage, trailing estimates, compaction and context edits", async () => {
  const faux = fauxProvider({
    models: [{ id: "context", contextWindow: 1000 }],
  });
  const modelRuntime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    modelsStore: new InMemoryModelsStore(),
    modelsPath: null,
    refreshOnCreate: false,
  });
  modelRuntime.registerNativeProvider(faux.provider);
  await modelRuntime.refresh({ allowNetwork: false });
  const services = await createAgentSessionServices({
    cwd: process.cwd(),
    modelRuntime,
    settingsManager: SettingsManager.inMemory(
      { cacheWarming: "off" },
      { projectTrusted: false },
    ),
    resourceLoaderOptions: {
      noExtensions: true,
      noSkills: true,
      noThemes: true,
      noContextFiles: true,
      noPromptTemplates: true,
    },
  });
  const manager = SessionManager.inMemory();
  const { session } = await createAgentSessionFromServices({
    services,
    sessionManager: manager,
    model: faux.getModel(),
    noTools: "all",
  });
  try {
    manager.appendMessage({ role: "user", content: "12345678", timestamp: 1 });
    expect(projectedContextUsage(session)?.tokens).toBeGreaterThan(0);
    const assistant = {
      ...fauxAssistantMessage("answer"),
      usage: {
        ...fauxAssistantMessage("").usage,
        input: 90,
        output: 10,
        totalTokens: 100,
      },
    };
    const answer = manager.appendMessage(assistant);
    manager.appendMessage({ role: "user", content: "12345678", timestamp: 2 });
    expect(projectedContextUsage(session)?.tokens).toBeGreaterThanOrEqual(100);
    manager.appendContextEdit(answer, null);
    expect(projectedContextUsage(session)?.tokens).toBeLessThan(100);
    manager.appendCompaction("summary", null, 100);
    expect(projectedContextUsage(session)).toEqual({
      tokens: null,
      contextWindow: 1000,
      percent: null,
    });
    manager.appendMessage({ ...assistant, timestamp: 3 });
    expect(projectedContextUsage(session)?.tokens).toBe(100);
    manager.appendCompaction("again", null, 100);
    manager.appendMessage({ ...assistant, stopReason: "error", timestamp: 4 });
    expect(projectedContextUsage(session)?.tokens).toBeNull();
    expect(
      projectedContextUsage({ getContextUsage: () => undefined }),
    ).toBeNull();
  } finally {
    session.dispose();
  }
});
