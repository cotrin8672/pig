import { expect, test } from "bun:test";
import { traceOpen } from "./open-performance";

test("open diagnostics are opt-in, bounded and stop when the open settles", () => {
  let time = 0;
  const reports: unknown[] = [];
  const disabled = traceOpen(
    "disabled",
    false,
    () => {
      throw new Error("disabled tracing must do no work");
    },
    (value) => reports.push(value),
  );
  disabled.mark("unused");
  disabled.finish("ready");
  expect(reports).toHaveLength(0);
  const trace = traceOpen(
    "opaque-open-id",
    true,
    () => time,
    (value) => reports.push(value),
  );
  time = 10;
  trace.mark("session-manager");
  time = 25;
  trace.mark("model-runtime");
  time = 30;
  trace.finish("ready");
  trace.mark("late-hook");
  trace.finish("failed");
  expect(reports).toEqual([
    {
      openId: "opaque-open-id",
      outcome: "ready",
      totalMs: 30,
      stages: [
        { stage: "session-manager", ms: 10 },
        { stage: "model-runtime", ms: 15 },
      ],
    },
  ]);
  const bounded = traceOpen(
    "bounded",
    true,
    () => ++time,
    (value) => reports.push(value),
  );
  for (let i = 0; i < 1000; i++) bounded.mark("repeat");
  bounded.finish("failed");
  expect((reports[1] as { stages: unknown[] }).stages).toHaveLength(32);
});
