import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { UsageMeter } from "./UsageMeter";

test("UsageMeter bounds the drawing without changing either accessible value", () => {
  const label = "使用済み 120%、リセットまでの残り時間 0%";
  const html = renderToStaticMarkup(
    <UsageMeter
      quotaPercent={120}
      timePercent={0}
      label={label}
      tone="critical"
    />,
  );
  expect(html).toContain("--usage-quota:100%;--usage-time:0%");
  expect(html).toContain('class="usage-meter-frame"');
  expect(html).toContain('role="img"');
  expect(html).toContain(`aria-label="${label}"`);
});

test("UsageMeter omits the active outline when the time is unknown", () => {
  const html = renderToStaticMarkup(<UsageMeter quotaPercent={54} />);
  expect(html).toContain("--usage-quota:54%");
  expect(html).not.toContain("usage-meter-frame");
  expect(html).toContain('aria-hidden="true"');
});
