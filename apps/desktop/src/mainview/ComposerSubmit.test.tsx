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
      expect(html).toContain(stop ? "lucide-square" : "lucide-arrow-up");
      expect(html).not.toContain("spinner");
      expect(html).not.toContain('aria-busy="true"');
    }
  }
});

test("pending send replaces the action with a disabled spinner, even during a running response", () => {
  for (const busy of [false, true]) {
    for (const hasContent of [false, true]) {
      for (const disabled of [false, true]) {
        const html = renderToStaticMarkup(
          <ComposerSubmit
            busy={busy}
            submitting
            hasContent={hasContent}
            disabled={disabled}
            onStop={() => {}}
          />,
        );
        expect(html.match(/<button\b/g)).toHaveLength(1);
        expect(html).toContain('type="button"');
        expect(html).toContain('disabled=""');
        expect(html).toContain('aria-busy="true"');
        expect(html).toContain(`aria-label="${getT()["Sending…"]}"`);
        expect(html).toContain("lucide-loader-circle");
        expect(html).toContain("spinner");
        expect(html).not.toContain("lucide-arrow-up");
        expect(html).not.toContain("lucide-square");
        expect(html).not.toContain(`>${getT()["Sending…"]}<`);
      }
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
