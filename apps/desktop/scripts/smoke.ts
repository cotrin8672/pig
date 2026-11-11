import {
  fauxAssistantMessage,
  fauxProvider,
  InMemoryCredentialStore,
  InMemoryModelsStore,
} from "@earendil-works/pi-ai";
import { agentDir } from "../src/bun/runtime-profile";
import {
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "../src/bun/sdk";
import { SDKProjector } from "../src/bun/sdk-projector";
import { SendReceipts } from "../src/bun/sdk-send-receipts";

const faux = fauxProvider({ tokensPerSecond: Infinity });
faux.setResponses([fauxAssistantMessage("SDK smoke OK")]);
const models = await ModelRuntime.create({
  credentials: new InMemoryCredentialStore(),
  modelsStore: new InMemoryModelsStore(),
  modelsPath: null,
  refreshOnCreate: false,
});
models.registerNativeProvider(faux.provider);
await models.refresh({ allowNetwork: false });
const runtime = await createAgentSessionRuntime(
  async ({ cwd, agentDir, sessionManager }) => {
    const services = await createAgentSessionServices({
      cwd,
      agentDir,
      modelRuntime: models,
      settingsManager: SettingsManager.inMemory(
        { cacheWarming: "off" },
        { projectTrusted: false },
      ),
      resourceLoaderOptions: {
        noExtensions: true,
        noSkills: true,
        noThemes: true,
        noPromptTemplates: true,
        noContextFiles: true,
      },
    });
    return {
      ...(await createAgentSessionFromServices({
        services,
        sessionManager,
        model: faux.getModel(),
        noTools: "all",
      })),
      services,
      diagnostics: services.diagnostics,
    };
  },
  {
    cwd: process.cwd(),
    agentDir,
    sessionManager: SessionManager.inMemory(process.cwd()),
  },
);
const projector = new SDKProjector(runtime.session.sessionManager, 1);
const unsubscribe = runtime.session.subscribe((event) =>
  projector.event(event),
);
try {
  const receipts = new SendReceipts("smoke");
  const input = {
    hostId: "smoke",
    sessionId: runtime.session.sessionManager.getSessionId(),
    epoch: 1,
    requestId: "smoke",
    draftRevision: 0,
    text: "Smoke",
  };
  const accepted = await receipts.send(
    input,
    runtime.session,
    async () => ({ text: input.text }),
    (error) => {
      throw error;
    },
  );
  if (accepted.disposition !== "started")
    throw new Error("Missing SDK acceptance");
  await receipts.settled();
  const snapshot = projector.snapshot();
  if (
    snapshot.running ||
    !snapshot.records.some(
      (r) => r.kind === "message" && r.message.role === "assistant",
    )
  )
    throw new Error("Missing settled SDK response");
  console.log(
    "SDK smoke OK; no login, network, project code, or persistent session storage used.",
  );
} finally {
  unsubscribe();
  await runtime.dispose();
}
