import type { StatisticsData, StatisticsPeriod } from "../../shared/statistics";

export type StatisticValue =
  | string
  | number
  | boolean
  | null
  | StatisticValue[]
  | { [key: string]: StatisticValue };

/** Metadata only. Never pass SDK events, credentials or tool arguments here. */
export interface StatisticEvent {
  id: string;
  version: 1;
  owner: string;
  project: string;
  session: string;
  host: string;
  binding: string;
  sequence: number;
  at: number;
  type: string;
  run: string | null;
  request: string | null;
  call: string | null;
  parentCall: string | null;
  data: Record<string, StatisticValue>;
}

export interface StatisticsSink {
  record(event: StatisticEvent): void;
  forget(owner: string): Promise<void>;
}

export type StatisticsCommand =
  | { type: "open"; file: string }
  | { type: "batch"; events: StatisticEvent[]; dropped: number; id: number }
  | { type: "forget"; owner: string; id: number }
  | { type: "flush"; id: number }
  | {
      type: "query";
      period: StatisticsPeriod;
      id: number;
      progressive?: boolean;
    }
  | { type: "close"; id: number };

export type StatisticsReply =
  | { type: "ready" }
  | { type: "ack"; id: number }
  | { type: "snapshot"; id: number; data: StatisticsData }
  | { type: "progress"; id: number; data: Partial<StatisticsData> }
  | { type: "error"; code: "storage" | "protocol" };
