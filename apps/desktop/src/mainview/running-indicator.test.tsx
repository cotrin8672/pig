import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { en } from "../shared/i18n";
import { RunningIndicator } from "./RunningIndicator";
import { TURN_SPINNERS } from "./running-indicator/TurnSpinner";

function spinnerVariant(turnKey?: string) {
  const html = renderToStaticMarkup(<RunningIndicator turnKey={turnKey} />);
  const variant = /data-turn-spinner="([^"]+)"/.exec(html)?.[1];
  if (!variant) throw new Error(`Missing spinner variant for ${turnKey}`);
  return variant;
}

test("the default status pairs a decorative spinner with the fixed label", () => {
  const html = renderToStaticMarkup(<RunningIndicator />);
  expect(html).toContain('role="status"');
  expect(html).toContain(en["Working…"]);
  expect(html).toContain('aria-hidden="true"');
  expect(html).toContain(`data-turn-spinner="${spinnerVariant()}"`);
});

test("turn keys select all 18 variants and keep their choice across renders", () => {
  const keys = Array.from({ length: 256 }, (_, i) => `session/turn-${i}`);
  const variants = keys.map(spinnerVariant);
  const available = Object.keys(TURN_SPINNERS);
  expect(available).toHaveLength(18);
  expect(new Set(variants)).toEqual(new Set(available));
  expect(keys.reverse().map(spinnerVariant)).toEqual(variants.reverse());
});

test("an extension symbol replaces the spinner with either label", () => {
  for (const message of [undefined, "Shipping it"]) {
    const html = renderToStaticMarkup(
      <RunningIndicator symbol="🐖" message={message} turnKey="extension" />,
    );
    expect(html).toContain("🐖");
    expect(html).toContain(message ?? en["Working…"]);
    expect(html).not.toContain("data-turn-spinner");
  }
});
