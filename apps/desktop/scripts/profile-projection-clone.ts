// Offline synthetic projections only; no user sessions, config or credentials.
import { cloneProjection } from "../src/bun/clone-projection";

for (const characters of [1024, 1024 * 1024, 4 * 1024 * 1024]) {
  const input = {
    message: {
      role: "assistant",
      content: [{ type: "text", text: "x".repeat(characters) }],
      usage: { output: 100 },
    },
    tools: {
      call: {
        status: "running",
        result: {
          content: [{ type: "text", text: "y".repeat(characters) }],
          details: { progress: 1 },
        },
      },
    },
  };
  for (const [name, clone] of [
    ["native", structuredClone],
    ["projection", cloneProjection],
  ] as const) {
    for (let i = 0; i < 100; i++) clone(input);
    const samples: number[] = [];
    for (let i = 0; i < 200; i++) {
      const start = performance.now();
      clone(input);
      samples.push(performance.now() - start);
    }
    samples.sort((a, b) => a - b);
    console.info(
      JSON.stringify({
        charactersPerBody: characters,
        name,
        meanMs: samples.reduce((sum, ms) => sum + ms, 0) / samples.length,
        p95Ms: samples[Math.floor(samples.length * 0.95)],
        scope: "Bun projection clone CPU only; not IPC, WebView or heap usage",
      }),
    );
  }
}
