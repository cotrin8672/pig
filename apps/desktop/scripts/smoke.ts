import { registerBunOAuthFlows } from "@earendil-works/pi-ai/bun-oauth";
import {
  createAgentSession,
  ModelRuntime,
  SessionManager,
} from "@earendil-works/pi-coding-agent";

registerBunOAuthFlows();
const runtime = await ModelRuntime.create();
await runtime.getAvailable();
for (const provider of runtime.getProviders()) {
  const status = runtime.getProviderAuthStatus(provider.id);
  console.log(
    `${provider.id}: configured=${status.configured}${status.source ? ` (${status.label ?? status.source})` : ""}`,
  );
}
const { session } = await createAgentSession({
  modelRuntime: runtime,
  sessionManager: SessionManager.inMemory(),
});
console.log(`In-memory session created; messages=${session.messages.length}`);
session.dispose();
console.log("Session disposed; no prompt or login performed.");
