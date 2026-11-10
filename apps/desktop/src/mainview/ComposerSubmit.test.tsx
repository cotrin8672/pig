import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ComposerSubmit } from "./ComposerSubmit";
import { getT } from "./i18n";

test("one action switches between send and stop without blocking follow-ups", () => {
  for (const busy of [false, true]) {
    for (const hasContent of [false, true]) {
      const html = renderToStaticMarkup(
        <ComposerSubmit
          busy={busy}
          hasContent={hasContent}
          disabled={!hasContent}
          onStop={() => {}}
        />,
      );
      const stop = busy && !hasContent;
      expect(html.match(/<button\b/g)).toHaveLength(1);
      expect(html).toContain(`type="${stop ? "button" : "submit"}"`);
      expect(html).toContain(
        `aria-label="${stop ? getT().Stop : getT().Send}"`,
      );
      expect(html.includes('disabled=""')).toBe(!busy && !hasContent);
    }
  }
});

test("send validation does not disable stopping an active response", () => {
  for (const hasContent of [false, true]) {
    const html = renderToStaticMarkup(
      <ComposerSubmit
        busy
        hasContent={hasContent}
        disabled
        onStop={() => {}}
      />,
    );
    expect(html.includes('disabled=""')).toBe(hasContent);
  }
});
