import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { FontPicker } from "./FontPicker";

test("font picker labels its searchable list and marks the saved selection without decorative font previews", () => {
  const html = renderToStaticMarkup(
    <FontPicker
      label="Interface font"
      value="游ゴシック"
      fonts={["Arial", "游ゴシック"]}
      onChange={() => {}}
    />,
  );
  expect(html).toContain('aria-label="Interface font: 游ゴシック"');
  expect(html).toContain('role="combobox"');
  expect(html).toContain('aria-autocomplete="list"');
  expect(html).toContain('role="listbox" aria-label="Interface font"');
  expect(html.match(/role="option"/g)).toHaveLength(3);
  expect(html).toContain('aria-selected="true"');
  expect(html).toContain("System default");
  expect(html).not.toContain("font-family:");
});

test("font picker retains the saved name and allows resetting when fonts are unavailable", () => {
  const html = renderToStaticMarkup(
    <FontPicker
      label="Code font"
      value="Missing font"
      fonts={[]}
      onChange={() => {}}
    />,
  );
  expect(html).toContain("Missing font");
  expect(html.match(/role="option"/g)).toHaveLength(1);
  expect(html).toContain("System default");
});
