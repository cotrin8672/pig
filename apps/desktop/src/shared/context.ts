import { dictionary } from "./i18n";
import type { ContextUsage } from "./rpc-schema";
import type { Settings } from "./settings";

export type ContextSummary = {
  percent: number | null;
  title: string;
  /** Tooltip heading and detail line; absent while usage is unknown. */
  heading?: string;
  detail?: string;
};

export function contextSummary(
  usage?: ContextUsage | null,
  mode: Settings["contextDisplay"] = "remaining",
  language: Settings["language"] = "en",
): ContextSummary {
  const t = dictionary(language);
  // Token counts read as k/M in every language (not 万).
  const tokens = new Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: 1,
  });
  const format = (count: number) => tokens.format(count).replace("K", "k");
  if (
    !usage ||
    !Number.isFinite(usage.contextWindow) ||
    usage.contextWindow <= 0
  )
    return { percent: null, title: t.contextUnavailable };
  const limit = format(usage.contextWindow);
  if (
    usage.tokens === null ||
    !Number.isFinite(usage.tokens) ||
    usage.tokens < 0
  )
    return { percent: null, title: t.contextPending(limit) };
  const used = Math.min(usage.contextWindow, Math.max(0, usage.tokens));
  const count = mode === "used" ? used : usage.contextWindow - used;
  const percent = Math.min(
    100,
    Math.max(0, Math.round((count / usage.contextWindow) * 100)),
  );
  return {
    percent,
    title: t.context(percent, mode, format(count), limit),
    heading: t.contextHeading(percent, mode),
    detail: t.contextDetail(
      format(used),
      limit,
      format(usage.contextWindow - used),
    ),
  };
}
