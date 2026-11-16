import { useEffect, useState } from "react";
import type { StatisticsData, StatisticsPeriod } from "../shared/statistics";
import { useT } from "./i18n";
import { rpc } from "./rpc";
import { StatisticsView } from "./StatisticsView";
import { showError } from "./store";

const empty: StatisticsData = {
  collectingSince: null,
  days: [],
  daily: {},
  models: [],
  tools: [],
  initialContext: {
    parts: [],
    sections: [],
    sources: [],
    measuredTotal: null,
    contextWindow: null,
  },
  coverage: { unknownUsage: 0, dropped: 0, collection: "active" },
};

/** Mounted only on the statistics page. Late period responses cannot replace newer data. */
export function Statistics() {
  const t = useT().statisticsText;
  const [period, setPeriod] = useState<StatisticsPeriod>("7d");
  const [refresh, setRefresh] = useState(0);
  const [data, setData] = useState(empty);
  const [busy, setBusy] = useState(true);
  const [failed, setFailed] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: manual refresh restarts this polling generation.
  useEffect(() => {
    let disposed = false;
    let running = false;
    let timer: ReturnType<typeof setTimeout>;
    let notified = false;
    const load = async () => {
      if (running || disposed) return;
      running = true;
      setBusy(true);
      try {
        const next = await rpc.request.statistics({ period });
        if (!disposed) {
          setData(next);
          setFailed(false);
          notified = false;
        }
      } catch {
        if (!disposed) {
          setFailed(true);
          if (!notified) showError(t.failed);
          notified = true;
        }
      } finally {
        running = false;
        if (!disposed) {
          setBusy(false);
          clearTimeout(timer);
          timer = setTimeout(() => {
            if (!document.hidden) void load();
          }, 30_000);
        }
      }
    };
    const focus = () => {
      void load();
    };
    void load();
    window.addEventListener("focus", focus);
    return () => {
      disposed = true;
      clearTimeout(timer);
      window.removeEventListener("focus", focus);
    };
  }, [period, refresh, t.failed]);
  return (
    <StatisticsView
      data={data}
      period={period}
      busy={busy}
      onPeriod={(next) => {
        if (next !== period) {
          setData(empty);
          setPeriod(next);
        }
      }}
      onRefresh={() => setRefresh((n) => n + 1)}
      status={
        failed ? (
          t.failed
        ) : (
          <span
            aria-description={t.coverage(
              data.coverage.unknownUsage,
              data.coverage.dropped,
            )}
          >
            {data.coverage.collection === "disabled"
              ? t.disabled
              : busy && !data.collectingSince
                ? t.loading
                : data.coverage.unknownUsage || data.coverage.dropped
                  ? t.partial
                  : !data.collectingSince
                    ? t.noRecords
                    : null}
          </span>
        )
      }
    />
  );
}
