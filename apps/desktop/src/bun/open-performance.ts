type OpenTiming = {
  openId: string;
  outcome: string;
  totalMs: number;
  stages: { stage: string; ms: number }[];
};

/** Opt-in, bounded diagnostics. Never log paths, prompts, credentials or errors. */
export function traceOpen(
  openId: string,
  enabled = process.env.PIG_PERF_OPEN === "1",
  now = () => performance.now(),
  report: (timing: OpenTiming) => void = (timing) =>
    console.info("[pig:open-performance]", JSON.stringify(timing)),
) {
  const started = enabled ? now() : 0;
  let previous = started;
  let finished = false;
  const stages: OpenTiming["stages"] = [];
  return {
    mark(stage: string) {
      if (!enabled || finished) return;
      const time = now();
      if (stages.length < 32)
        stages.push({ stage, ms: Math.round((time - previous) * 100) / 100 });
      previous = time;
    },
    finish(outcome: string) {
      if (!enabled || finished) return;
      finished = true;
      report({
        openId,
        outcome,
        totalMs: Math.round((now() - started) * 100) / 100,
        stages,
      });
    },
  };
}
