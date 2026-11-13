/** Host-owned observations only. No credentials or raw upstream bodies cross IPC. */
export const USAGE_REFRESH_COOLDOWN_MS = 10_000;
export type UsageDisplay = "remaining" | "used";
export type UsageSource = "api" | "response" | "cli";
export type UsageProblem =
  | "auth"
  | "permission"
  | "rate-limit"
  | "network"
  | "format"
  | "unavailable";
export interface UsageWindow {
  id: string;
  label: string;
  /** Preserve >100 (PAYG/overage); clamp only when drawing. */
  usedPercent: number;
  resetsAt?: number;
  durationMs?: number;
}
export interface UsageBalance {
  label: string;
  amount: string;
  currency: string;
}
const currencySymbols: Record<string, string> = {
  USD: "$",
  EUR: "€",
  CNY: "¥",
  JPY: "¥",
};
export function balanceText(balance: UsageBalance) {
  return `${currencySymbols[balance.currency] ?? `${balance.currency} `}${balance.amount}`;
}
export interface UsageData {
  windows: UsageWindow[];
  balances: UsageBalance[];
  details?: string[];
}
export interface ProviderUsage {
  key: string;
  provider: string;
  label: string;
  /** Omitted for default credentials and CLI-owned identities. */
  accountId?: string;
  source: UsageSource;
  status: "loading" | "ready" | "error";
  observedAt?: number;
  data?: UsageData;
  problem?: UsageProblem;
  retryAt?: number;
}
export const usageKey = (provider: string, accountId?: string) =>
  JSON.stringify([provider, accountId ?? null]);
export const clampPercent = (value: number) =>
  Math.max(0, Math.min(100, value));
export const usagePercent = (used: number, display: UsageDisplay) =>
  display === "used" ? used : Math.max(0, 100 - used);
export const usageLevel = (used: number) =>
  used >= 90 ? "critical" : used >= 75 ? "warning" : "normal";
export function timeRemaining(window: UsageWindow, now: number) {
  if (window.resetsAt === undefined || !window.durationMs) return undefined;
  return clampPercent(((window.resetsAt - now) / window.durationMs) * 100);
}
export function shortDate(at: number) {
  const date = new Date(at);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}
export function resetCountdown(at: number, now: number) {
  const seconds = Math.max(0, Math.ceil((at - now) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  if (minutes >= 1440) return shortDate(at);
  const rest = minutes % 60;
  return `${Math.floor(minutes / 60)}h${rest ? ` ${rest}m` : ""}`;
}
export function observationAge(at: number, now: number) {
  const seconds = Math.max(0, Math.floor((now - at) / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h`;
}
export function headlineWindow(entry: ProviderUsage) {
  return entry.data?.windows.reduce<UsageWindow | undefined>(
    (worst, next) =>
      !worst || next.usedPercent > worst.usedPercent ? next : worst,
    undefined,
  );
}
export function sortUsage(entries: ProviderUsage[]) {
  return [...entries].sort(
    (a, b) =>
      a.label.localeCompare(b.label, undefined, {
        sensitivity: "base",
        numeric: true,
      }) || a.key.localeCompare(b.key),
  );
}
