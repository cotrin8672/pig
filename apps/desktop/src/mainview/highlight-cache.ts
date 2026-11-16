import type { ThemedToken } from "shiki/core";

export const HIGHLIGHT_CACHE_BYTES = 16 * 1024 * 1024;
const MAX_ENTRIES = 32;
type Tokens = ThemedToken[][];
type Entry = {
  controller: AbortController;
  promise: Promise<Tokens | undefined>;
  waiters: number;
  leases: number;
  done: boolean;
  bytes: number;
  tokens?: Tokens;
};

// Charge strings independently, even when an engine shares their storage.
function weight(key: string, tokens: Tokens) {
  let bytes = 256 + key.length * 2 + tokens.length * 64;
  for (const line of tokens)
    for (const token of line)
      bytes +=
        192 +
        2 *
          (token.content.length +
            (token.color?.length ?? 0) +
            (token.bgColor?.length ?? 0));
  return bytes;
}

/** Completed results have a budget; outstanding computations remain shared.
 * A caller's signal leases the result until effect cleanup, not just resolution. */
export function createHighlightCache(
  compute: (
    text: string,
    language: string,
    signal: AbortSignal,
  ) => Promise<Tokens | undefined>,
  maxBytes = HIGHLIGHT_CACHE_BYTES,
) {
  const pending = new Map<string, Entry>();
  const cached = new Map<string, Entry>();
  let bytes = 0;
  const keyOf = (text: string, language: string) => `${language}\0${text}`;
  const remove = (key: string, entry: Entry) => {
    if (cached.get(key) !== entry) return;
    cached.delete(key);
    bytes -= entry.bytes;
  };
  const trim = () => {
    while (cached.size > MAX_ENTRIES || bytes > maxBytes) {
      const oldest = cached.entries().next().value;
      if (!oldest) break;
      const unused = [...cached].find(([, entry]) => !entry.leases);
      const [key, entry] = unused ?? oldest;
      remove(key, entry);
    }
  };
  const touch = (key: string) => {
    const entry = cached.get(key);
    if (entry) {
      cached.delete(key);
      cached.set(key, entry);
    }
    return entry;
  };
  const consume = (entry: Entry, key: string, signal?: AbortSignal) =>
    new Promise<Tokens | undefined>((resolve) => {
      entry.waiters++;
      let waiting = true;
      let leased = !!signal;
      if (leased) entry.leases++;
      const release = () => {
        signal?.removeEventListener("abort", abort);
        if (leased) {
          leased = false;
          entry.leases--;
        }
      };
      const abort = () => {
        release();
        if (!waiting) return;
        waiting = false;
        entry.waiters--;
        if (!entry.done && !entry.waiters) {
          entry.controller.abort();
          if (pending.get(key) === entry) pending.delete(key);
        }
        resolve(undefined);
      };
      signal?.addEventListener("abort", abort, { once: true });
      void entry.promise.then((tokens) => {
        if (!waiting) return;
        waiting = false;
        entry.waiters--;
        if (!tokens) release();
        resolve(tokens);
      });
    });
  return {
    peek(text: string, language: string) {
      return touch(keyOf(text, language))?.tokens;
    },
    run(text: string, language: string, signal?: AbortSignal) {
      if (signal?.aborted) return Promise.resolve(undefined);
      const key = keyOf(text, language);
      let entry = touch(key) ?? pending.get(key);
      if (!entry) {
        const controller = new AbortController();
        entry = {
          controller,
          promise: Promise.resolve(undefined),
          waiters: 0,
          leases: 0,
          done: false,
          bytes: 0,
        };
        const created = entry;
        pending.set(key, created);
        created.promise = Promise.resolve()
          .then(() => compute(text, language, controller.signal))
          .catch(() => undefined)
          .then((tokens) => {
            created.done = true;
            if (pending.get(key) === created) pending.delete(key);
            if (controller.signal.aborted) return undefined;
            if (tokens) {
              created.tokens = tokens;
              created.bytes = weight(key, tokens);
              if (created.bytes <= maxBytes) {
                cached.set(key, created);
                bytes += created.bytes;
                trim();
              }
            }
            return tokens;
          });
      }
      return consume(entry, key, signal);
    },
    stats: () => ({ entries: cached.size, bytes, pending: pending.size }),
  };
}
