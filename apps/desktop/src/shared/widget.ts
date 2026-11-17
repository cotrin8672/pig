/** An in-conversation visualization: an HTML or SVG fragment rendered in an isolated frame. */
export type WidgetBlock = {
  /** Content hash; keys remembered heights and frames. */
  id: string;
  format: "html" | "svg";
  source: string;
  title?: string;
  width: "regular" | "wide";
  origin: "tool" | "codex" | "mcp";
  /** The fragment carries script; without script execution parts of it stay empty. */
  interactive: boolean;
};

/** Fragments above this are not rendered (they also cost model context on every turn). */
export const WIDGET_MAX_BYTES = 1024 * 1024;

/** Claude-style `show_widget({ title, widget_code })`, as pig's tool and pi-generative-ui use it. */
export const WIDGET_TOOLS = new Set(["show_widget", "visualize:show_widget"]);

const hash = (text: string) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
};

export function widgetBlock(
  source: string,
  options: Pick<WidgetBlock, "origin"> &
    Partial<Pick<WidgetBlock, "title" | "width">>,
): WidgetBlock {
  return {
    id: `${hash(source)}-${source.length.toString(36)}`,
    format: /^\s*<svg[\s>]/i.test(source) ? "svg" : "html",
    source,
    title: options.title,
    width: options.width ?? "regular",
    origin: options.origin,
    interactive: /<script[\s>]|\son[a-z]+\s*=|javascript:/i.test(source),
  };
}

/** Builds a block from a widget tool call's arguments, also while they stream. */
export function widgetFromTool(
  args: Record<string, unknown>,
): WidgetBlock | undefined {
  const code = args.widget_code;
  if (typeof code !== "string" || !code.trim()) return undefined;
  return widgetBlock(code, {
    origin: "tool",
    title: typeof args.title === "string" ? args.title : undefined,
    width: args.mode === "wide" ? "wide" : "regular",
  });
}
