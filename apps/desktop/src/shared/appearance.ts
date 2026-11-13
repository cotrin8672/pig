import type { Appearance, Backdrop } from "./rpc-schema";
import { defaultThemeColor, normalizeThemeColor } from "./theme-color";

export const defaultAppearance: Appearance = {
  backdrop: "acrylic",
  effect: "acrylic",
  themeColor: defaultThemeColor,
  opacity: { none: 0.78, acrylic: 0.78, mica: 0.78 },
};
export function toggleBackdrop(appearance: Appearance): Appearance {
  return {
    ...appearance,
    backdrop: appearance.backdrop === "none" ? appearance.effect : "none",
  };
}
export function validateAppearance(value: unknown): Appearance {
  if (!value || typeof value !== "object")
    throw new Error("Invalid appearance.");
  const input = value as Partial<Appearance> & { opacity?: unknown };
  const { backdrop } = input;
  if (backdrop !== "none" && backdrop !== "acrylic" && backdrop !== "mica")
    throw new Error("Invalid appearance.");
  const effect = input.effect ?? (backdrop === "none" ? "acrylic" : backdrop);
  if (effect !== "acrylic" && effect !== "mica")
    throw new Error("Invalid appearance.");
  const opacity = {} as Record<Backdrop, number>;
  for (const mode of ["none", "acrylic", "mica"] as const) {
    const alpha =
      typeof input.opacity === "number" ? input.opacity : input.opacity?.[mode];
    if (typeof alpha !== "number" || !Number.isFinite(alpha))
      throw new Error("Invalid appearance.");
    opacity[mode] = Math.min(1, Math.max(0, alpha));
  }
  const themeColor =
    input.themeColor === undefined
      ? defaultThemeColor
      : normalizeThemeColor(input.themeColor);
  if (!themeColor) throw new Error("Invalid theme color.");
  return { backdrop, effect, opacity, themeColor };
}
