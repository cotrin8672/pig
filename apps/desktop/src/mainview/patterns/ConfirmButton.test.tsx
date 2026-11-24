import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ConfirmButton } from "./ConfirmButton";

test("ConfirmButton starts idle with both labels stacked and no announcement", () => {
  const html = renderToStaticMarkup(
    <ConfirmButton onConfirm={() => {}} className="primary">
      Install
    </ConfirmButton>,
  );
  expect(html).toContain('type="button"');
  expect(html).toContain('class="confirm-button primary "');
  expect(html).toContain(
    '<span class="confirm-idle" aria-hidden="false">Install</span>',
  );
  expect(html).toContain('class="confirm-armed" aria-hidden="true"');
  expect(html).toContain(
    '<span class="confirm-status" aria-live="polite"></span>',
  );
});
