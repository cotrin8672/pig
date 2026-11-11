import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ComposerSubmit } from "./ComposerSubmit";
import { getT } from "./i18n";

test("Stop stays enabled beside a next draft, images or a pending send", () => {
  for (const hasContent of [false, true]) {
    for (const submitting of [false, true]) {
      const html = renderToStaticMarkup(
        <ComposerSubmit
          busy
          hasContent={hasContent}
          submitting={submitting}
          disabled
          onStop={() => {}}
        />,
      );
      const buttons = html.match(/<button\b[^>]*>/g) ?? [];
      expect(buttons[0]).toContain(`aria-label="${getT().Stop}"`);
      expect(buttons[0]).toContain('type="button"');
      expect(buttons[0]).toContain('aria-keyshortcuts="Escape"');
      expect(buttons[0]).not.toContain("disabled");
      expect(buttons).toHaveLength(hasContent || submitting ? 2 : 1);
      if (buttons[1]) expect(buttons[1]).toContain("disabled");
    }
  }
});

test("a pending idle send has an independent cancel action and keeps the sending spinner", () => {
  const html = renderToStaticMarkup(
    <ComposerSubmit
      busy={false}
      hasContent
      submitting
      disabled
      onStop={() => {}}
    />,
  );
  expect(html.match(/<button\b/g)).toHaveLength(2);
  expect(html).toContain('aria-label="Cancel send"');
  expect(html).toContain('aria-busy="true"');
  expect(html).toContain("spinner");
});

test("idle Send preserves validation, and stopping disables both actions", () => {
  for (const disabled of [false, true]) {
    const html = renderToStaticMarkup(
      <ComposerSubmit
        busy={false}
        hasContent
        disabled={disabled}
        onStop={() => {}}
      />,
    );
    expect(html.match(/<button\b/g)).toHaveLength(1);
    expect(html).toContain('type="submit"');
    expect(html.includes("disabled")).toBe(disabled);
  }
  const stopping = renderToStaticMarkup(
    <ComposerSubmit
      busy
      stopping
      hasContent
      disabled={false}
      onStop={() => {}}
    />,
  );
  expect(stopping).toContain('aria-label="Stopping…"');
  expect(stopping.match(/disabled=""/g)).toHaveLength(2);
});
