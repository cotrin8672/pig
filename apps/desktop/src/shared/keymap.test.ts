import { expect, test } from "bun:test";
import {
  comboFromEvent,
  defaultBindings,
  matchesCombo,
  normalizeCombo,
  resolveBindings,
} from "./keymap";

const event = (key: string, extra = {}) => ({
  key,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...extra,
});

test("combos normalize case and modifier order", () => {
  expect(normalizeCombo("shift+ctrl+b")).toBe("Ctrl+Shift+B");
  expect(normalizeCombo("Ctrl+,")).toBe("Ctrl+,");
  expect(normalizeCombo("alt+arrowleft")).toBe("Alt+ArrowLeft");
  for (const invalid of ["Ctrl", "Ctrl+Ctrl+B", "Mod+B", "", "Ctrl+"])
    expect(normalizeCombo(invalid)).toBeNull();
});
test("matches require exact modifiers and a non-modifier key", () => {
  expect(
    matchesCombo(
      event("B", { ctrlKey: true, shiftKey: true }),
      defaultBindings["appearance.toggleBackdrop"],
    ),
  ).toBe(true);
  expect(matchesCombo(event("b", { ctrlKey: true }), "Ctrl+Shift+B")).toBe(
    false,
  );
  expect(matchesCombo(event(",", { ctrlKey: true }), "Ctrl+,")).toBe(true);
  expect(matchesCombo(event("b"), null)).toBe(false);
  expect(comboFromEvent(event("Control", { ctrlKey: true }))).toBeNull();
});
test("overrides preserve defaults, null disables and deletion resets", () => {
  const overrides = { "settings.open": null } as const;
  expect(resolveBindings(overrides)["settings.open"]).toBeNull();
  expect(resolveBindings(overrides)["navigation.back"]).toBe("Alt+ArrowLeft");
  expect(resolveBindings({})["settings.open"]).toBe("Ctrl+,");
});

test("captured punctuation and whitespace round trip through normalization", () => {
  for (const key of ["+", " ", ",", "=", "?", "F12", "ArrowLeft"]) {
    const input = event(key, { ctrlKey: true, shiftKey: true });
    const combo = comboFromEvent(input);
    expect(combo).not.toBeNull();
    expect(normalizeCombo(combo ?? "")).toBe(combo);
    expect(matchesCombo(input, combo)).toBe(true);
  }
});
