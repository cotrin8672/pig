export type Hsv = { h: number; s: number; v: number };
const clamp = (value: number) => Math.max(0, Math.min(100, value));

/** The picker edits sRGB HSV; theme generation uses perceptual HCT separately. */
export function hsvToHex({ h, s, v }: Hsv): string {
  const saturation = clamp(s) / 100;
  const value = clamp(v) / 100;
  const hue = ((h % 360) + 360) % 360;
  const channel = (offset: number) => {
    const k = (offset + hue / 60) % 6;
    return Math.round(
      (value - value * saturation * Math.max(0, Math.min(k, 4 - k, 1))) * 255,
    )
      .toString(16)
      .padStart(2, "0");
  };
  return `#${channel(5)}${channel(3)}${channel(1)}`;
}

export function hexToHsv(hex: string, previousHue = 0): Hsv {
  const [r, g, b] = [1, 3, 5].map(
    (offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255,
  );
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const h =
    delta === 0
      ? previousHue
      : 60 *
        (max === r
          ? ((g - b) / delta + 6) % 6
          : max === g
            ? (b - r) / delta + 2
            : (r - g) / delta + 4);
  return { h, s: max === 0 ? 0 : (delta / max) * 100, v: max * 100 };
}

export function colorAtPoint(
  x: number,
  y: number,
  width: number,
  height: number,
) {
  return {
    s: clamp((x / Math.max(1, width)) * 100),
    v: 100 - clamp((y / Math.max(1, height)) * 100),
  };
}
