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

test("a send that has not started yet turns the same button into a cancellable spinner", () => {
  const html = render({ waiting: true, hasContent: true });
  expect(buttons(html)).toHaveLength(1);
  expect(html).toContain("spinner");
  expect(html).toContain('aria-label="Cancel send"');
  expect(html).toContain('aria-busy="true"');
  expect(buttons(html)[0]).not.toContain("disabled");
});

test("a running response shows Stop, plus Send only for a typed next message", () => {
  for (const hasContent of [false, true]) {
    for (const waiting of [false, true]) {
      const html = render({ busy: true, hasContent, waiting, disabled: true });
      const [stop, send] = buttons(html);
      expect(stop).toContain(`aria-label="${getT().Stop}"`);
      expect(stop).toContain('aria-keyshortcuts="Escape"');
      expect(stop).not.toContain("disabled");
      expect(html).not.toContain("spinner");
      expect(buttons(html)).toHaveLength(hasContent ? 2 : 1);
      if (send) expect(send).toContain('type="submit"');
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
