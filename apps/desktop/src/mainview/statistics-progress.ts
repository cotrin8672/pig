import type { StatisticsProgress } from "../shared/statistics";

const listeners = new Map<string, (data: StatisticsProgress["data"]) => void>();
export function receiveStatisticsProgress({
  requestId,
  data,
}: StatisticsProgress) {
  listeners.get(requestId)?.(data);
}
export function listenStatistics(
  requestId: string,
  receive: (data: StatisticsProgress["data"]) => void,
) {
  listeners.set(requestId, receive);
  return () => listeners.delete(requestId);
}
