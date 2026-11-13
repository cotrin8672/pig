import { UsageError, type UsageHttp } from "./contracts";

const MAX_BYTES = 512 * 1024;
export function retryAfter(value: string | null, now: number) {
  if (!value) return now + 60_000;
  const seconds = Number(value);
  const at = Number.isFinite(seconds)
    ? now + Math.max(0, seconds) * 1000
    : Date.parse(value);
  // Even Retry-After: 0 must not create a hot loop.
  return Math.max(now + 60_000, Number.isFinite(at) ? at : now + 60_000);
}
/** One small, bounded, non-redirecting transport. Never logs headers or response bodies. */
export function usageHttp(
  fetcher: typeof fetch = fetch,
  now = Date.now,
): UsageHttp {
  return {
    async get(url, headers, signal) {
      const target = new URL(url);
      if (target.protocol !== "https:" || target.username || target.password)
        throw new UsageError("unavailable");
      try {
        const response = await fetcher(url, {
          headers: { Accept: "application/json", ...headers },
          redirect: "error",
          signal: AbortSignal.any([signal, AbortSignal.timeout(12_000)]),
        });
        if (!response.ok) {
          await response.body?.cancel();
          if (response.status === 401) throw new UsageError("auth");
          if (response.status === 403) throw new UsageError("permission");
          if (response.status === 429)
            throw new UsageError(
              "rate-limit",
              retryAfter(response.headers.get("retry-after"), now()),
            );
          throw new UsageError(
            response.status === 404 ? "unavailable" : "network",
          );
        }
        const reader = response.body?.getReader();
        if (!reader) throw new UsageError("format");
        const chunks: Uint8Array[] = [];
        let length = 0;
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            length += value.length;
            if (length > MAX_BYTES) throw new UsageError("format");
            chunks.push(value);
          }
        } finally {
          await reader.cancel().catch(() => {});
        }
        const body = new Uint8Array(length);
        let offset = 0;
        for (const chunk of chunks) {
          body.set(chunk, offset);
          offset += chunk.length;
        }
        try {
          return JSON.parse(new TextDecoder().decode(body));
        } catch {
          throw new UsageError("format");
        }
      } catch (error) {
        if (error instanceof UsageError) throw error;
        throw new UsageError("network");
      }
    },
  };
}
