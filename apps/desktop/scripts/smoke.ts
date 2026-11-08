import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
} from "@earendil-works/pi-ai";
import { registerBunOAuthFlows } from "@earendil-works/pi-ai/bun-oauth";
import {
  createRegistry,
  Harness,
  MemoryStorage,
} from "@earendil-works/pi-durable";

registerBunOAuthFlows();
const faux = fauxProvider({ tokensPerSecond: Infinity });
faux.setResponses([fauxAssistantMessage("Durable smoke OK")]);
const models = createModels();
models.setProvider(faux.provider);
const harness = await Harness.open(
  new MemoryStorage(),
  { models, registry: createRegistry() },
  context,
);
try {
  const model = faux.getModel();
  const conversation = await harness.createConversation(
    {
      ownership: { kind: "ownerless" },
      agent: { model: { provider: model.provider, modelId: model.id } },
    },
    context,
  );
  const submission = await conversation.submit(
    { type: "input", content: "Smoke", requestId: "smoke" },
    context,
  );
  const result = await submission.wait(context);
  if (result.status !== "done") throw new Error("Smoke submission failed");
  console.log(
    "Durable smoke OK; no login, network, or persistent storage used.",
  );
} finally {
  await harness.close(context);
}
