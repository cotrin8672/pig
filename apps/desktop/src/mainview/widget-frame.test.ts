import { expect, test } from "bun:test";
import { widgetBlock, widgetFromTool } from "../shared/widget";
import { widgetDocument } from "./widget-frame";

test("widget tool arguments become a block, also while streaming", () => {
  expect(widgetFromTool({ title: "x" })).toBeUndefined();
  expect(widgetFromTool({ widget_code: "  " })).toBeUndefined();
  const svg = widgetFromTool({
    title: "Flow",
    widget_code: '<svg viewBox="0 0 1 1"></svg>',
  });
  expect(svg).toMatchObject({
    format: "svg",
    title: "Flow",
    width: "regular",
    interactive: false,
  });
  const html = widgetFromTool({
    widget_code: "<div>a</div><script>1</script>",
    mode: "wide",
  });
  expect(html).toMatchObject({
    format: "html",
    width: "wide",
    interactive: true,
  });
  expect(
    widgetBlock('<b onclick="x()">', { origin: "codex" }).interactive,
  ).toBe(true);
  expect(widgetFromTool({ widget_code: "<p>a</p>" })?.id).toBe(
    widgetFromTool({ widget_code: "<p>a</p>", title: "t" })?.id,
  );
});

test("frame documents allow script and network only in script mode", () => {
  const block = widgetBlock("<p>hi</p><script>x</script>", { origin: "tool" });
  const plain = widgetDocument(block, { scripts: false, theme: "--a:1;" });
  expect(plain).toContain("default-src 'none'");
  expect(plain).not.toContain("script-src");
  expect(plain).not.toContain("piris:widget-size");
  expect(plain).toContain("<body><p>hi</p><script>x</script></body>");
  const scripted = widgetDocument(block, { scripts: true, theme: "" });
  expect(scripted).toContain(
    "script-src 'unsafe-inline' https://cdnjs.cloudflare.com",
  );
  expect(scripted).toContain("connect-src 'none'");
  expect(scripted).toContain("piris:widget-size");
});

test("MCP documents cannot inherit the dynamic widget policy", () => {
  const block = widgetBlock("<p>static</p>", { origin: "mcp" });
  const html = widgetDocument(block, { scripts: true, theme: "" });
  expect(html).toContain("script-src 'none'");
  expect(html).toContain("connect-src 'none'");
  expect(html).toContain("frame-src 'none'");
  expect(html).not.toContain("piris:widget-size");
});
