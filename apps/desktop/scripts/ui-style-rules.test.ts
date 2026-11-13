import { describe, expect, test } from "bun:test";
import { checkUiStyles } from "./check-ui-styles";
import { lintUiCss, lintUiTsx } from "./ui-style-rules";

const css = (source: string, file = "src/mainview/feature.css") =>
  lintUiCss(source, file).map((issue) => issue.rule);
const tsx = (source: string) =>
  lintUiTsx(source, "src/mainview/Feature.tsx").map((issue) => issue.rule);

describe("UI style policy", () => {
  test("normal cards use translucent tokens, not opaque paint or group opacity", () => {
    expect(css(".new-card { background: var(--ds-tile) }")).toEqual([]);
    for (const value of [
      "#fff",
      "rgb(0 0 0)",
      "var(--ds-bg-secondary)",
      "transparent",
    ])
      expect(css(`.new-card { background: ${value} }`)).toContain(
        "card-surface-token",
      );
    expect(
      css(".session-panel { background-color: #fff; opacity: .8 }"),
    ).toEqual(["card-surface-token", "card-content-opacity"]);
    expect(
      css('.response-error, [data-ui-surface="card"] { background: red }'),
    ).toEqual(["card-surface-token"]);
    expect(
      css(".new-card:hover { background: var(--ds-tile-hover); opacity: 1 }"),
    ).toEqual([]);
  });

  test("CSS AST handles nested rules, media queries, comments and card descendants", () => {
    expect(
      css(
        "/* .new-card { background: red } */ .new-card button { background: transparent; opacity: .5 }",
      ),
    ).toEqual([]);
    expect(
      css(
        "@media (width < 500px) { .new-card { &:hover { background: red } } }",
      ),
    ).toEqual(["card-surface-token"]);
    expect(
      css(".new-card { @media (width < 500px) { background: red } }"),
    ).toEqual(["card-surface-token"]);
    expect(css(".new-card { & button { background: transparent } }")).toEqual(
      [],
    );
    expect(
      css("button:has(.new-card), button:not(.new-card) { background: red }"),
    ).toEqual([]);
    expect(
      css(
        ':is(.new-card, .other), [data-ui-surface = "card"] { background: red }',
      ),
    ).toEqual(["card-surface-token"]);
    expect(css(".new-card { filter: opacity(.5) }")).toEqual([
      "card-content-opacity",
    ]);
    const [issue] = lintUiCss(
      ".new-card {\n  background: red;\n}",
      "feature.css",
    );
    expect(issue).toMatchObject({ file: "feature.css", line: 2, column: 3 });
  });

  test("approved tokens cannot quietly become opaque or completely transparent", () => {
    for (const color of ["#ffffff08", "#fff8"])
      expect(css(`:root { --ds-tile: ${color} }`)).toEqual([]);
    for (const color of ["#fff", "#ffffffff", "#ffffff00", "rgb(0 0 0)"])
      expect(css(`:root { --ds-tile: ${color} }`)).toEqual([
        "translucent-card-token",
      ]);
  });

  test("local native and WebKit geometry overrides are rejected, thumb colour is allowed", () => {
    expect(
      css(".list { scrollbar-width: thin; scrollbar-color: red transparent }"),
    ).toEqual(["native-scrollbar-override", "native-scrollbar-override"]);
    expect(
      css(".list { scrollbar-width: auto; scrollbar-color: auto }"),
    ).toEqual([]);
    expect(css(".list::-webkit-scrollbar-track { margin: 0 }")).toEqual([
      "shared-scrollbar-geometry",
    ]);
    expect(
      css(".list::-webkit-scrollbar-thumb { border: 0; width: 2px }"),
    ).toEqual(["shared-scrollbar-geometry", "shared-scrollbar-geometry"]);
    expect(
      css(
        ".list:hover::-webkit-scrollbar-thumb { background-color: transparent }",
      ),
    ).toEqual([]);
    expect(css(".list { --scrollbar-size: 1px }")).toEqual([
      "shared-scrollbar-size",
    ]);
    const central = "src/mainview/styles.css";
    expect(
      css(
        "* { --scrollbar-size: 8px } ::-webkit-scrollbar-track { margin: 4px }",
        central,
      ),
    ).toEqual([]);
    expect(css(".list::-webkit-scrollbar { width: 1px }", central)).toEqual([
      "shared-scrollbar-geometry",
    ]);
  });

  test("inline JSX cannot bypass card paint policy; layout styles are fine", () => {
    for (const style of [
      '{background: "red"}',
      "{opacity: .5}",
      "{...paint}",
      "paint",
      '{[key]: "red"}',
    ])
      expect(tsx(`<div className="example-card" style={${style}} />`)).toEqual([
        "card-inline-paint",
      ]);
    expect(
      tsx(
        `<div className={\`example-card \${active ? "active" : ""}\`} style={{backgroundColor: "red"}} />`,
      ),
    ).toEqual(["card-inline-paint"]);
    expect(tsx('<div data-ui-surface="card" style={{opacity: .5}} />')).toEqual(
      ["card-inline-paint"],
    );
    expect(
      tsx(
        '<div className="example-card" style={{width: 200, marginTop: 8}} />',
      ),
    ).toEqual([]);
    expect(
      tsx('<div className="other" style={{background: "red"}} />'),
    ).toEqual([]);
    expect(tsx(`const example = '<div className="example-card" />';`)).toEqual(
      [],
    );
  });

  test("current production CSS and JSX comply", async () => {
    expect(await checkUiStyles()).toEqual([]);
  });
});
