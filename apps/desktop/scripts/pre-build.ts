import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { stageSdkRuntime } from "./sdk-runtime-assets";

/** The host's single-file bundle cannot resolve a source-only worker at runtime. */
export async function buildStatisticsWorker(projectDir: string) {
  const outdir = join(projectDir, "build/statistics");
  await mkdir(outdir, { recursive: true });
  const result = await Bun.build({
    entrypoints: [join(projectDir, "src/bun/statistics/worker.ts")],
    target: "bun",
    outdir,
    naming: "statistics-worker.js",
  });
  if (!result.success)
    throw new AggregateError(result.logs, "Statistics worker build failed");
}

export async function buildChatHistoryWorker(projectDir: string) {
  const result = await Bun.build({
    entrypoints: [join(projectDir, "src/bun/chat-history-worker.ts")],
    target: "bun",
    outdir: join(projectDir, "build/chat-history"),
    naming: "chat-history-worker.js",
  });
  if (!result.success)
    throw new AggregateError(result.logs, "Chat history worker build failed");
}

export default async function preBuild() {
  stageSdkRuntime();
  await buildStatisticsWorker(join(import.meta.dir, ".."));
  await buildChatHistoryWorker(join(import.meta.dir, ".."));
}
if (import.meta.main) await preBuild();
