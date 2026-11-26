import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function tauriSmokeProfile() {
  const home = await mkdtemp(join(tmpdir(), "pig-tauri-smoke-"));
  let requests = 0;
  const model = "pig-smoke-model";
  const chunk = (delta: object, finish_reason: string | null) =>
    `data: ${JSON.stringify({
      id: "pig-smoke",
      object: "chat.completion.chunk",
      created: 1,
      model,
      choices: [{ index: 0, delta, finish_reason }],
    })}\n\n`;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      if (
        request.method !== "POST" ||
        new URL(request.url).pathname !== "/v1/chat/completions"
      )
        return new Response(null, { status: 404 });
      requests++;
      return new Response(
        chunk(
          { role: "assistant", content: "Windows Tauri smoke reply" },
          null,
        ) +
          chunk({}, "stop") +
          "data: [DONE]\n\n",
        { headers: { "Content-Type": "text/event-stream" } },
      );
    },
  });
  const dispose = async () => {
    await server.stop(true);
    await rm(home, {
      recursive: true,
      force: true,
      maxRetries: 8,
      retryDelay: 100,
    });
  };
  try {
    const config = join(home, "config");
    const agent = join(home, "agent");
    await mkdir(join(config, "extensions"), { recursive: true });
    await mkdir(agent, { recursive: true });
    const provider = {
      api: "openai-completions",
      apiKey: "test-only",
      baseUrl: `http://127.0.0.1:${server.port}/v1`,
      models: [
        {
          id: model,
          name: model,
          contextWindow: 16384,
          maxTokens: 1024,
          input: ["text"],
          reasoning: false,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        },
      ],
    };
    await writeFile(
      join(config, "extensions", "fixture.ts"),
      `export default (pi) => pi.registerProvider("pig-smoke", ${JSON.stringify(provider)});\n`,
    );
    return {
      requests: () => requests,
      env: {
        HOME: home,
        USERPROFILE: home,
        APPDATA: join(home, "roaming"),
        LOCALAPPDATA: join(home, "local"),
        WEBVIEW2_USER_DATA_FOLDER: join(home, "webview"),
        PIG_DESKTOP_CONFIG_DIR: config,
        PI_CODING_AGENT_DIR: agent,
        PI_OFFLINE: "1",
      },
      dispose,
    };
  } catch (error) {
    await dispose();
    throw error;
  }
}
