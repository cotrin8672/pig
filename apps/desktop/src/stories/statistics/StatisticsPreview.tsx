import { useState } from "react";
import { StatisticsView } from "../../mainview/StatisticsView";
import type { StatisticsPeriod } from "../../shared/statistics";
import type { StatisticsFixture } from "./statistics-data";

/** The production view, with fixture-only controls and no host requests. */
export function StatisticsPage({ data }: { data: StatisticsFixture }) {
  const [period, setPeriod] = useState<StatisticsPeriod>("7d");
  return <StatisticsView data={data} period={period} onPeriod={setPeriod} />;
}
