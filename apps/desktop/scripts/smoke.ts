import { registerBunOAuthFlows } from "@earendil-works/pi-ai/bun-oauth";
import {
  createAgentSession,
  ModelRuntime,
  SessionManager,
} from "@earendil-works/pi-coding-agent";

registerBunOAuthFlows();
const runtime = await ModelRuntime.create();
for (const provider of ["openai-codex", "anthropic"]) {
  console.log(
    `${provider}: OAuth=${runtime.isUsingOAuth(provider)}, configured=${runtime.hasConfiguredAuth(provider)}`,
  );
}
const { session } = await createAgentSession({
  modelRuntime: runtime,
  sessionManager: SessionManager.inMemory(),
});
console.log(`In-memory session created; messages=${session.messages.length}`);
session.dispose();
console.log("Session disposed; no prompt or login performed.");
