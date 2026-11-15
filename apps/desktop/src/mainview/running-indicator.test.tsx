import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { en } from "../shared/i18n";
import { RunningIndicator } from "./RunningIndicator";

test("the wait line pairs a spinner with a verb from the pool", () => {
  const html = renderToStaticMarkup(<RunningIndicator />);
  expect(html).toContain('class="muted running-line"');
  expect(html).toContain('class="running-glyph"');
  expect(html).toContain(`${en.workingVerbs[0]}…`);
  // The rotating text is decorative; the live region keeps the stable label.
  expect(html).toContain(`<span class="sr-status">${en["Working…"]}</span>`);
});

test("an extension working message replaces the rotating verb", () => {
  const html = renderToStaticMarkup(
    <RunningIndicator symbol="🐖" message="Shipping it" />,
  );
  expect(html).toContain("🐖 Shipping it");
  expect(html).not.toContain(`${en.workingVerbs[0]}…`);
  expect(html).toContain('<span class="sr-status">Shipping it</span>');
});
