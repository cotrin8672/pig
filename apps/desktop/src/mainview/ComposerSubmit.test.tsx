import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ComposerSubmit } from "./ComposerSubmit";
import { getT } from "./i18n";

const render = (props: Partial<Parameters<typeof ComposerSubmit>[0]>) =>
  renderToStaticMarkup(
    <ComposerSubmit
      busy={false}
      hasContent={false}
      disabled={false}
      onStop={() => {}}
      {...props}
    />,
  );
const buttons = (html: string) => html.match(/<button\b[^>]*>/g) ?? [];

test("idle shows one Send button that keeps its validation", () => {
  for (const disabled of [false, true]) {
    const html = render({ hasContent: true, disabled });
    expect(buttons(html)).toHaveLength(1);
    expect(html).toContain('type="submit"');
    expect(html).not.toContain("spinner");
    expect(html.includes("disabled")).toBe(disabled);
  }
});

test("interrupted empty composer shows Resume; a draft still uses Send", () => {
  const html = render({ resumable: true });
  expect(buttons(html)).toHaveLength(1);
  expect(html).toContain(`aria-label="${getT().Resume}"`);
  expect(html).toContain("lucide-play");
  expect(html).toContain('type="submit"');
  expect(html).not.toContain("disabled");
  expect(render({ resumable: true, disabled: true })).toContain("disabled");
  const draft = render({ resumable: true, hasContent: true });
  expect(draft).toContain(`aria-label="${getT().Send}"`);
  expect(draft).not.toContain("lucide-play");
  for (const props of [{ waiting: true }, { stopping: true }, { busy: true }]) {
    const pending = render({ resumable: true, ...props });
    expect(pending).not.toContain(`aria-label="${getT().Resume}"`);
    expect(buttons(pending)).toHaveLength(1);
  }
});

test("a pending send shows one disabled spinner, even while a response is running", () => {
  for (const busy of [false, true]) {
    for (const hasContent of [false, true]) {
      const html = render({ busy, waiting: true, hasContent });
      expect(buttons(html)).toHaveLength(1);
      expect(html).toContain("spinner");
      expect(html).toContain(`aria-label="${getT()["Sending…"]}"`);
      expect(html).toContain('aria-busy="true"');
      expect(buttons(html)[0]).toContain("disabled");
      expect(html).not.toContain("Cancel send");
    }
  }
});

test("a running response shows only Send with content, otherwise only Stop", () => {
  for (const hasContent of [false, true]) {
    for (const disabled of [false, true]) {
      const html = render({ busy: true, hasContent, disabled });
      const [button] = buttons(html);
      expect(buttons(html)).toHaveLength(1);
      expect(html).not.toContain("spinner");
      if (hasContent) {
        expect(button).toContain(`aria-label="${getT().Send}"`);
        expect(button).toContain('type="submit"');
        expect(html.includes("disabled")).toBe(disabled);
        expect(html).not.toContain("lucide-square");
      } else {
        expect(button).toContain(`aria-label="${getT().Stop}"`);
        expect(button).toContain('aria-keyshortcuts="Escape"');
        expect(button).not.toContain("disabled");
      }
    }
  }
});

test("Stop waits on a disabled spinner until the host confirms", () => {
  for (const busy of [false, true]) {
    const html = render({ busy, stopping: true, hasContent: true });
    expect(buttons(html)).toHaveLength(1);
    expect(html).toContain("spinner");
    expect(html).toContain('aria-label="Stopping…"');
    expect(buttons(html)[0]).toContain("disabled");
  }
});
