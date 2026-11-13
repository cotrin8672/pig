import type {
  UsageData,
  UsageProblem,
  UsageSource,
} from "../../shared/provider-usage";

export class UsageError extends Error {
  constructor(
    public readonly code: UsageProblem,
    public readonly retryAt?: number,
  ) {
    // Only fixed codes: upstream errors can contain tokens, identifiers or bodies.
    super(`Provider usage: ${code}`);
  }
}
export interface UsageAuth {
  token: string;
  kind: "oauth" | "api-key";
  accountId?: string;
  /** Provider-specific auth, e.g. the GitHub (not Copilot inference) token. */
  githubToken?: string;
}
export interface UsageTarget {
  key: string;
  provider: string;
  label: string;
  accountId?: string;
  source: UsageSource;
  /** Changes whenever credentials/identity/config change; never sent to the UI. */
  revision: string;
  read(signal: AbortSignal): Promise<UsageData>;
  intervalMs?: number;
}
export interface UsageHttp {
  get(
    url: string,
    headers: Record<string, string>,
    signal: AbortSignal,
  ): Promise<unknown>;
}
export type JsonObject = Record<string, unknown>;
export function object(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}
export function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
export function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}
export function decimal(value: unknown): string | undefined {
  const text =
    typeof value === "number" && Number.isFinite(value) ? String(value) : value;
  return typeof text === "string" && /^-?\d+(?:\.\d+)?$/.test(text)
    ? text
    : undefined;
}
export function timestamp(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0)
    return value < 100_000_000_000 ? value * 1000 : value;
  if (typeof value === "string") {
    const at = Date.parse(value);
    if (Number.isFinite(at)) return at;
  }
  return undefined;
}
export function nonempty(data: UsageData): UsageData {
  if (!data.windows.length && !data.balances.length)
    throw new UsageError("unavailable");
  return data;
}
