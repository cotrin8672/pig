import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { en } from "../shared/i18n";
import { RunningIndicator } from "./RunningIndicator";

test("the wait line keeps the original static label without a spinner", () => {
  const html = renderToStaticMarkup(<RunningIndicator />);
  expect(html).toBe(
    `<p class="muted running" role="status">${en["Working…"]}</p>`,
  );
});

test("an extension working message and symbol still override the label", () => {
  const html = renderToStaticMarkup(
    <RunningIndicator symbol="🐖" message="Shipping it" />,
  );
  expect(html).toBe(
    '<p class="muted running" role="status">🐖 Shipping it</p>',
  );
});

test("an extension symbol also accompanies the default label", () => {
  expect(renderToStaticMarkup(<RunningIndicator symbol="🐖" />)).toContain(
    `🐖 ${en["Working…"]}`,
  );
});
