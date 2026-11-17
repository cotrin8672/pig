import type { Element, Root, RootContent } from "hast";
import { fromHtmlIsomorphic } from "hast-util-from-html-isomorphic";
import { type Schema, sanitize } from "hast-util-sanitize";
import { toHtml } from "hast-util-to-html";
import postcss from "postcss";
import { MCP_APP_MAX_BYTES } from "../shared/mcp-app";

const maxElements = 4096;
const maxDepth = 64;
const maxCssBytes = 128 * 1024;
const htmlTags =
  "div span p br hr section article header footer main aside nav h1 h2 h3 h4 h5 h6 ul ol li dl dt dd table caption thead tbody tfoot tr th td colgroup col pre code blockquote b strong i em u s small sub sup mark kbd samp time figure figcaption details summary";
const svgTags =
  "svg g path rect circle ellipse line polyline polygon text tspan defs linearGradient radialGradient stop clipPath";
const schema: Schema = {
  tagNames: `${htmlTags} ${svgTags} style`.split(" "),
  strip: [
    "script",
    "iframe",
    "object",
    "embed",
    "template",
    "noscript",
    "title",
    "math",
    "foreignObject",
    "animate",
    "animateTransform",
    "set",
  ],
  attributes: {
    "*": [
      "id",
      "className",
      "style",
      "role",
      "ariaLabel",
      "ariaHidden",
      "ariaLabelledBy",
      "ariaDescribedBy",
      "dir",
      "lang",
    ],
    td: ["colSpan", "rowSpan"],
    th: ["colSpan", "rowSpan", "scope"],
    col: ["span"],
    svg: ["viewBox", "width", "height", "preserveAspectRatio"],
    ...Object.fromEntries(
      svgTags
        .split(" ")
        .map((tag) => [
          tag,
          [
            "viewBox",
            "width",
            "height",
            "preserveAspectRatio",
            "d",
            "points",
            "x",
            "y",
            "x1",
            "x2",
            "y1",
            "y2",
            "cx",
            "cy",
            "r",
            "rx",
            "ry",
            "dx",
            "dy",
            "fill",
            "fillRule",
            "fillOpacity",
            "stroke",
            "strokeWidth",
            "strokeOpacity",
            "strokeLinecap",
            "strokeLinejoin",
            "strokeDasharray",
            "opacity",
            "transform",
            "textAnchor",
            "dominantBaseline",
            "fontSize",
            "fontFamily",
            "offset",
            "stopColor",
            "stopOpacity",
            "gradientUnits",
            "gradientTransform",
            "clipPath",
          ],
        ]),
    ),
  },
  // This document is permanently script/form/bridge-free; keep IDs for SVG and CSS references.
  clobber: [],
};
const cssProperties = new Set(
  (
    "color background-color display visibility opacity width height min-width min-height max-width max-height " +
    "margin margin-top margin-right margin-bottom margin-left padding padding-top padding-right padding-bottom padding-left " +
    "border border-width border-style border-color border-top border-right border-bottom border-left border-radius box-sizing " +
    "font font-family font-size font-weight font-style line-height letter-spacing word-spacing text-align text-decoration " +
    "white-space word-break overflow-wrap vertical-align list-style-type border-collapse border-spacing table-layout " +
    "flex flex-direction flex-wrap flex-grow flex-shrink flex-basis align-items align-content align-self justify-content gap row-gap column-gap " +
    "grid grid-template-columns grid-template-rows grid-column grid-row grid-auto-flow place-items " +
    "position top right bottom left inset z-index overflow overflow-x overflow-y " +
    "fill stroke stroke-width stroke-dasharray stroke-linecap stroke-linejoin fill-opacity stroke-opacity " +
    "text-anchor dominant-baseline transform transform-origin aspect-ratio"
  ).split(" "),
);
const safeValue = (value: string) =>
  value.length <= 1024 &&
  !/[\\<>@]/.test(value) &&
  (!/url\s*\(/i.test(value) || /^url\(#[a-z0-9_-]+\)$/i.test(value));

function staticCss(source: string, inline: boolean) {
  if (Buffer.byteLength(source, "utf8") > maxCssBytes)
    throw new Error("MCP_APP_COMPLEX_HTML");
  try {
    const tree = postcss.parse(inline ? `x{${source}}` : source);
    let count = 0;
    tree.walk((node) => {
      if (++count > 4096) throw new Error("MCP_APP_COMPLEX_HTML");
      if (
        (node.type === "atrule" &&
          (!["media", "supports"].includes(node.name.toLowerCase()) ||
            !safeValue(node.params))) ||
        (node.type === "rule" &&
          (node.selector.length > 512 ||
            /[\\<>]|:has\(|::-webkit-scrollbar/i.test(node.selector))) ||
        (node.type === "decl" &&
          ((!cssProperties.has(node.prop.toLowerCase()) &&
            !/^--[a-z0-9_-]+$/i.test(node.prop)) ||
            !safeValue(node.value)))
      )
        node.remove();
      if (node.type === "decl") node.important = false;
      if (node.type === "comment") node.remove();
    });
    return inline
      ? tree.first?.type === "rule"
        ? tree.first.nodes.map((node) => node.toString()).join(";")
        : ""
      : tree.toString();
  } catch {
    return "";
  }
}

/** Native streaming preflight bounds work before the JS HTML/CSS parsers allocate a tree. */
async function preflight(html: string) {
  let count = 0;
  let depth = 0;
  await new HTMLRewriter()
    .on("*", {
      element(element) {
        if (++count > maxElements || ++depth > maxDepth)
          throw new Error("MCP_APP_COMPLEX_HTML");
        if (element.canHaveContent)
          element.onEndTag(() => {
            depth--;
          });
        else depth--;
      },
    })
    .transform(new Response(html))
    .text();
}

/** Returns a fragment, never a server-supplied document head, URL or executable markup. */
export async function staticMcpApp(html: string): Promise<string> {
  if (Buffer.byteLength(html, "utf8") > MCP_APP_MAX_BYTES)
    throw new Error("MCP_APP_TOO_LARGE");
  await preflight(html);
  const root = fromHtmlIsomorphic(html, { fragment: true });
  let nodes = 0;
  let cssBytes = 0;
  const clean = (parent: Root | Element, depth: number) => {
    if (depth > maxDepth) throw new Error("MCP_APP_COMPLEX_HTML");
    for (const node of parent.children) {
      if (++nodes > 8192) throw new Error("MCP_APP_COMPLEX_HTML");
      if (node.type !== "element") continue;
      const props = node.properties;
      for (const property of ["fill", "stroke", "clipPath"])
        if (
          typeof props[property] === "string" &&
          !safeValue(props[property] as string)
        )
          delete props[property];
      for (const property of ["d", "points"])
        if (
          typeof props[property] === "string" &&
          props[property].length > 32768
        )
          delete props[property];
      if (typeof props.style === "string") {
        cssBytes += Buffer.byteLength(props.style, "utf8");
        props.style = staticCss(props.style, true);
      }
      if (node.tagName === "style") {
        const text = node.children
          .filter((child) => child.type === "text")
          .map((child) => child.value)
          .join("");
        cssBytes += Buffer.byteLength(text, "utf8");
        node.children = [{ type: "text", value: staticCss(text, false) }];
      }
      if (cssBytes > maxCssBytes) throw new Error("MCP_APP_COMPLEX_HTML");
      clean(node, depth + 1);
    }
  };
  clean(root, 0);
  const safe = sanitize(root, schema);
  const result = toHtml(safe as RootContent | Root);
  if (Buffer.byteLength(result, "utf8") > MCP_APP_MAX_BYTES)
    throw new Error("MCP_APP_TOO_LARGE");
  return result;
}
