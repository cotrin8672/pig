import { SessionStatistics } from "./collector";
import type { StatisticEvent } from "./contracts";

export function fixture() {
  const events: StatisticEvent[] = [];
  let now = 0;
  const collector = new SessionStatistics(
    {
      profile: "profile",
      cwd: "project",
      session: "session",
      host: "host",
      epoch: 1,
    },
    { record: (event) => events.push(event), forget: async () => {} },
    () => now,
  );
  return { events, collector, advance: (ms: number) => (now += ms) };
}
