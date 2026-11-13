import type { Provider, ProviderResponse } from "@earendil-works/pi-ai";
import type { UsageData, UsageWindow } from "../../shared/provider-usage";

export interface UsageObservation {
  provider: string;
  accountId?: string;
  /** Host-only ownership evidence; never logged, persisted or sent over RPC. */
  token?: string;
  response: ProviderResponse;
}
let listener: ((event: UsageObservation) => Promise<void>) | undefined;
export function setUsageObserver(next: typeof listener) {
  listener = next;
}

/** Wrap only the response hook; no network, credential reads or awaited monitoring on the chat path. */
export function withUsageObservation(
  provider: Provider,
  selection: () => string | undefined,
): Provider {
  if (provider.id !== "anthropic" && provider.id !== "openai-codex")
    return provider;
  const observe = (
    accountId: string | undefined,
    token: string | undefined,
    response: ProviderResponse,
  ) => {
    const sink = listener;
    if (!sink) return;
    queueMicrotask(() => {
      try {
        void sink({ provider: provider.id, accountId, token, response }).catch(
          () => {},
        );
      } catch {
        /* Monitoring must never break a model request. */
      }
    });
  };
  return {
    ...provider,
    stream(model, context, options) {
      const accountId = selection();
      return provider.stream(model, context, {
        ...options,
        onResponse(response, m) {
          observe(accountId, options?.apiKey, response);
          return options?.onResponse?.(response, m);
        },
      } as typeof options);
    },
    streamSimple(model, context, options) {
      const accountId = selection();
      return provider.streamSimple(model, context, {
        ...options,
        onResponse(response, m) {
          observe(accountId, options?.apiKey, response);
          return options?.onResponse?.(response, m);
        },
      });
    },
  };
}
export function usageFromHeaders(
  provider: string,
  headers: Record<string, string>,
  now: number,
): UsageData {
  const h = new Headers(headers);
  const windows: UsageWindow[] = [];
  const numeric = (key: string) => {
    const raw = h.get(key);
    if (raw === null || raw.trim() === "") return undefined;
    const value = Number(raw);
    return Number.isFinite(value) ? value : undefined;
  };
  if (provider === "anthropic") {
    for (const [id, label, duration] of [
      ["five_hour", "5h", 18000000],
      ["seven_day", "7d", 604800000],
    ] as const) {
      const prefix = id === "five_hour" ? "5h" : "7d";
      const ratio = numeric(
        `anthropic-ratelimit-unified-${prefix}-utilization`,
      );
      if (ratio === undefined || ratio < 0) continue;
      const reset = numeric(`anthropic-ratelimit-unified-${prefix}-reset`);
      windows.push({
        id,
        label,
        usedPercent: ratio * 100,
        resetsAt: reset === undefined ? undefined : reset * 1000,
        durationMs: duration,
      });
    }
  } else if (provider === "openai-codex") {
    for (const id of ["primary", "secondary"]) {
      const used = numeric(`x-codex-${id}-used-percent`);
      if (used === undefined || used < 0) continue;
      const duration = numeric(`x-codex-${id}-window-minutes`);
      const after = numeric(`x-codex-${id}-reset-after-seconds`);
      windows.push({
        id: `Codex/${id}_window`,
        label:
          duration === 300
            ? "Codex / 5h"
            : duration === 10080
              ? "Codex / 7d"
              : id,
        usedPercent: used,
        resetsAt: after === undefined ? undefined : now + after * 1000,
        durationMs: duration && duration > 0 ? duration * 60000 : undefined,
      });
    }
  }
  return { windows, balances: [] };
}
