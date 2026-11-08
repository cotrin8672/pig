import type { Effort } from "./rpc-schema";

const order: Effort[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];
export const effortLabels = {
  off: "Off",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Max",
} as const satisfies Record<Effort, string>;
export type EffortMap = Partial<Record<Effort, string | null>>;

// Prefer the five ordinary levels over aliases such as minimal -> low.
export function effortOptions(
  available: readonly Effort[],
  map: EffortMap = {},
): Effort[] {
  const nativeValues = new Set<string>();
  const selected = new Set<Effort>();
  for (const level of [
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
    "off",
    "minimal",
  ] as const) {
    if (!available.includes(level) || map[level] === null) continue;
    const value = map[level] ?? level;
    if (nativeValues.has(value)) continue;
    nativeValues.add(value);
    selected.add(level);
  }
  return order.filter((level) => selected.has(level));
}
export function displayedEffort(
  current: Effort,
  levels: readonly Effort[],
  map: EffortMap = {},
): Effort {
  return (
    levels.find(
      (level) => (map[level] ?? level) === (map[current] ?? current),
    ) ??
    levels[0] ??
    "off"
  );
}
