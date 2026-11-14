// Synthetic temporary files only; no user sessions/config/credentials are opened.

import { appendFile, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { SessionManager } from "../src/bun/sdk";
import {
  readSessionListInfo,
  SessionListCache,
} from "../src/bun/session-list-cache";

const directory = await mkdtemp(join(tmpdir(), "pig-list-profile-"));
try {
  const cwd = join(directory, "project");
  const fileCount = 12;
  const body = "Synthetic assistant output 日本語\n".repeat(16 * 1024);
  for (let i = 0; i < fileCount; i++) {
    await writeFile(
      join(directory, `${i}.jsonl`),
      `${[
        {
          type: "session",
          id: `synthetic-${i}`,
          cwd,
          timestamp: "2026-01-01T00:00:00.000Z",
          version: 3,
        },
        {
          type: "message",
          message: { role: "user", content: `Question ${i}`, timestamp: i + 1 },
        },
        {
          type: "message",
          message: {
            role: "assistant",
            content: [{ type: "text", text: body }],
            timestamp: i + 2,
          },
        },
      ]
        .map((entry) => JSON.stringify(entry))
        .join("\n")}\n`,
    );
  }
  let reads = 0,
    bytesRead = 0;
  const cache = new SessionListCache({
    read: async (...args) => {
      reads++;
      const size = (await stat(args[0])).size;
      bytesRead += size;
      return readSessionListInfo(...args);
    },
  });
  const sdkList = async () =>
    (await SessionManager.list(cwd, directory)).map((info) => ({
      id: info.id,
      cwd,
      title: info.name ?? info.firstMessage ?? "New chat",
      modified: info.modified.getTime(),
    }));
  const samples: Record<string, unknown> = {};
  const measure = async (
    name: string,
    run: () => Promise<unknown>,
    iterations: number,
  ) => {
    const beforeReads = reads,
      beforeBytes = bytesRead;
    const times: number[] = [];
    let value: unknown;
    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      value = await run();
      times.push(performance.now() - start);
    }
    samples[name] = {
      iterations,
      meanMs: times.reduce((sum, ms) => sum + ms, 0) / times.length,
      metadataFileReads: reads - beforeReads,
      sourceBytesForMetadataReads: bytesRead - beforeBytes,
    };
    return value;
  };
  const expected = await measure("sdk-full-list", sdkList, 5);
  const cold = await measure(
    "metadata-cache-cold",
    () => cache.list(directory),
    1,
  );
  const warm = await measure(
    "metadata-cache-warm",
    () => cache.list(directory),
    5,
  );
  if (!isDeepStrictEqual(cold, expected) || !isDeepStrictEqual(warm, expected))
    throw new Error("SDK metadata mismatch");
  await appendFile(
    join(directory, "0.jsonl"),
    `${JSON.stringify({ type: "session_info", name: "Renamed" })}\n`,
  );
  const changed = await measure(
    "metadata-cache-one-file-changed",
    () => cache.list(directory),
    1,
  );
  if (!isDeepStrictEqual(changed, await sdkList()))
    throw new Error("Renamed metadata mismatch");
  console.info(
    JSON.stringify({
      fileCount,
      samples,
      scope:
        "Bun temporary files; cache reader counters only, SDK read counts are not instrumented; not real UI latency",
    }),
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
