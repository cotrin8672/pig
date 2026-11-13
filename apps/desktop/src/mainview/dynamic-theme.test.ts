import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { argbFromHex, Hct } from "@material/material-color-utilities";
import { defaultAppearance, validateAppearance } from "../shared/appearance";
import { defaultThemeColor, normalizeThemeColor } from "../shared/theme-color";
import { colorAtPoint, hexToHsv, hsvToHex } from "./color-space";
import { createThemeTokens } from "./dynamic-theme";
import { syntaxThemeColor } from "./syntax-theme";

function luminance(color: string) {
  const channels = [1, 3, 5].map((start) => {
    const c = Number.parseInt(color.slice(start, start + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}
function contrast(a: string, b: string) {
  const [low, high] = [luminance(a), luminance(b)].sort((x, y) => x - y);
  return (high + 0.05) / (low + 0.05);
}

const seeds = [
  defaultThemeColor,
  "#000000",
  "#ffffff",
  "#808080",
  "#ff0000",
  "#00ff00",
  "#0000ff",
  "#ffff00",
  "#ff00ff",
  "#00ffff",
  "#302017",
];
test("seed validation migrates old settings and rejects CSS injection/alpha/non-colours", () => {
  expect(
    validateAppearance({ backdrop: "none", opacity: 0.3 }).themeColor,
  ).toBe(defaultThemeColor);
  expect(normalizeThemeColor(" A3F ")).toBe("#aa33ff");
  for (const value of [
    null,
    32,
    "red",
    "#abcd",
    "#aabbccdd",
    "#gg0000",
    "var(--ds-accent)",
    "#fff; color:red",
  ])
    expect(() =>
      validateAppearance({ ...defaultAppearance, themeColor: value }),
    ).toThrow("theme color");
});

test("all seeds produce complete deterministic palettes with translucent surfaces", () => {
  const fallback = readFileSync(
    new URL("./tokens.css", import.meta.url),
    "utf8",
  );
  const keys = Object.keys(createThemeTokens(defaultThemeColor));
  for (const key of keys) expect(fallback).toContain(`${key}:`);
  for (const seed of seeds) {
    const tokens = createThemeTokens(seed);
    expect(tokens).toEqual(createThemeTokens(seed));
    expect(Object.keys(tokens)).toEqual(keys);
    expect(JSON.stringify(tokens)).not.toMatch(/NaN|undefined/);
    for (const key of [
      "--ds-tile",
      "--ds-tile-hover",
      "--ds-tool-row-bg",
      "--ds-bg-active",
      "--ds-bg-hover",
      "--ds-bg-popover",
    ] as const) {
      expect(tokens[key]).toMatch(/^#[\da-f]{8}$/);
      const alpha = Number.parseInt(tokens[key].slice(7), 16);
      expect(alpha).toBeGreaterThan(0);
      expect(alpha).toBeLessThan(255);
    }
    expect(tokens["--ds-bg-popover"].slice(7)).toBe("66");
    const seedHct = Hct.fromInt(argbFromHex(seed));
    const popover = Hct.fromInt(
      argbFromHex(tokens["--ds-bg-popover"].slice(0, 7)),
    );
    if (seedHct.chroma >= 4) {
      // Popover glass must keep the theme hue, not collapse to grey.
      expect(popover.chroma).toBeGreaterThan(8);
      const delta = Math.abs(popover.hue - seedHct.hue) % 360;
      expect(Math.min(delta, 360 - delta)).toBeLessThan(20);
    } else expect(popover.chroma).toBeLessThan(4);
  }
  expect(createThemeTokens("#ff0000")["--ds-shell-start"]).not.toBe(
    createThemeTokens("#0000ff")["--ds-shell-start"],
  );
  expect(createThemeTokens("not-a-color")).toEqual(
    createThemeTokens(defaultThemeColor),
  );
});

test("generated foreground/background pairs retain contrast, including saturated and neutral seeds", () => {
  for (const seed of seeds) {
    const t = createThemeTokens(seed);
    for (const background of [
      "--ds-bg-primary",
      "--ds-bg-secondary",
      "--ds-bg-inset",
    ] as const) {
      for (const foreground of [
        "--ds-text-primary",
        "--ds-text-secondary",
        "--ds-text-muted",
        "--ds-text-faint",
        "--ds-success",
        "--ds-error",
        "--ds-warning",
      ] as const)
        expect(
          contrast(t[foreground], t[background]),
          `${seed}: ${foreground}/${background}`,
        ).toBeGreaterThanOrEqual(4.5);
    }
    expect(
      contrast(t["--ds-accent"], t["--ds-on-accent"]),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrast(t["--ds-error"], t["--ds-on-error"]),
    ).toBeGreaterThanOrEqual(4.5);
    for (const role of [
      "keyword",
      "function",
      "type",
      "string",
      "number",
      "comment",
      "constant",
      "decorator",
      "text",
    ])
      expect(
        contrast(t[`--ds-syntax-${role}`], t["--ds-bg-inset"]),
        role,
      ).toBeGreaterThanOrEqual(4.5);
    // Extended semantic palettes remain recognizably green/amber; Error uses M3's red.
    const hue = (role: "success" | "warning" | "error") =>
      Hct.fromInt(argbFromHex(t[`--ds-${role}`])).hue;
    expect(hue("success")).toBeGreaterThan(120);
    expect(hue("success")).toBeLessThan(185);
    expect(hue("warning")).toBeGreaterThan(45);
    expect(hue("warning")).toBeLessThan(105);
    expect(hue("error")).toBeGreaterThan(10);
    expect(hue("error")).toBeLessThan(40);
  }
});

test("achromatic seeds do not acquire arbitrary colour in neutral or accent roles", () => {
  for (const seed of ["#000000", "#ffffff", "#808080"]) {
    const t = createThemeTokens(seed);
    for (const name of [
      "--ds-accent",
      "--ds-bg-primary",
      "--ds-text-primary",
    ] as const) {
      const color = t[name];
      expect(color.slice(1, 3)).toBe(color.slice(3, 5));
      expect(color.slice(3, 5)).toBe(color.slice(5, 7));
    }
  }
});

test("HSV editing roundtrips sRGB and preserves hue on black/white, with bounded pointer coordinates", () => {
  for (let r = 0; r <= 255; r += 51)
    for (let g = 0; g <= 255; g += 51)
      for (let b = 0; b <= 255; b += 51) {
        const hex = `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
        expect(hsvToHex(hexToHsv(hex))).toBe(hex);
      }
  expect(hexToHsv("#000000", 210).h).toBe(210);
  expect(hexToHsv("#ffffff", 210).h).toBe(210);
  expect(colorAtPoint(-5, 120, 100, 100)).toEqual({ s: 0, v: 0 });
  expect(colorAtPoint(120, -5, 100, 100)).toEqual({ s: 100, v: 100 });
  expect(colorAtPoint(0, 0, 0, 0)).toEqual({ s: 0, v: 100 });
});

test("syntax roles use CSS variables but unknown/explicit colours remain literal", () => {
  expect(syntaxThemeColor("#81A1C1")).toBe("var(--ds-syntax-keyword, #81A1C1)");
  expect(syntaxThemeColor("#d8dee9ff")).toContain("--ds-syntax-text");
  expect(syntaxThemeColor("#0c2238")).toBe("#0c2238");
  expect(syntaxThemeColor(undefined)).toBeUndefined();
});
