import { mkdir, rm, stat, utimes } from "node:fs/promises";
import { dirname } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

/** Directory creation is atomic across processes; heartbeat permits recovery after a crash. */
export async function withFileLock<T>(
  file: string,
  signal: AbortSignal | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  await mkdir(dirname(file), { recursive: true });
  const lock = `${file}.lock`;
  const deadline = Date.now() + 120_000;
  for (;;) {
    signal?.throwIfAborted();
    try {
      await mkdir(lock);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try {
        if (Date.now() - (await stat(lock)).mtimeMs > 60_000)
          await rm(lock, { recursive: true, force: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      if (Date.now() > deadline)
        throw new Error(`Timed out acquiring lock for ${file}`);
      await delay(25, undefined, { signal });
    }
  }
  const heartbeat = setInterval(() => {
    const now = new Date();
    void utimes(lock, now, now).catch(() => {});
  }, 10_000);
  heartbeat.unref();
  try {
    signal?.throwIfAborted();
    return await fn();
  } finally {
    clearInterval(heartbeat);
    await rm(lock, { recursive: true, force: true });
  }
}
