import { parse as parseScript } from "@babel/parser";
import postcss, { type AnyNode, type Rule } from "postcss";
import selectorParser from "postcss-selector-parser";

export type UiStyleIssue = {
  file: string;
  line: number;
  column: number;
  rule: string;
  message: string;
};

const cardTokens = new Set([
  "--ds-tile",
  "--ds-tile-hover",
  "--ds-tool-row-bg",
  "--ds-bg-hover",
  "--ds-bg-active",
]);
const cardClass = /^(?:[\w-]+-card|ui-card|session-panel|response-error)$/;
function isCardSubject(selector: selectorParser.Selector): boolean {
  // Only the subject, not ancestors or conditions such as :has() / :not().
  const nodes = selector.nodes;
  const lastCombinator = nodes.reduce(
    (last, node, index) => (node.type === "combinator" ? index : last),
    -1,
  );
  return nodes.slice(lastCombinator + 1).some((node) => {
    if (node.type === "class") return cardClass.test(node.value);
    if (node.type === "attribute")
      return node.attribute === "data-ui-surface" && node.value === "card";
    if (node.type === "pseudo" && [":is", ":where"].includes(node.value))
      return node.nodes.some(isCardSubject);
    return false;
  });
}
const isCardSelector = (selector: string) =>
  selectorParser().astSync(selector).nodes.some(isCardSubject);

function selectors(rule: Rule): string[] {
  let parent: AnyNode | undefined = rule.parent;
  while (parent && parent.type !== "rule") parent = parent.parent;
  if (!parent || parent.type !== "rule") return rule.selectors;
  return selectors(parent).flatMap((ancestor) =>
    rule.selectors.map((selector) =>
      selector.includes("&")
        ? selector.replaceAll("&", ancestor)
        : `${ancestor} ${selector}`,
    ),
  );
}

/** Deliberately a small, project-specific policy, not a general CSS linter. */
export function lintUiCss(source: string, file: string): UiStyleIssue[] {
  const issues: UiStyleIssue[] = [];
  const root = postcss.parse(source, { from: file });
  const central = file.replaceAll("\\", "/").endsWith("/mainview/styles.css");
  root.walkDecls((decl) => {
    const report = (rule: string, message: string) => {
      issues.push({
        file,
        line: decl.source?.start?.line ?? 1,
        column: decl.source?.start?.column ?? 1,
        rule,
        message,
      });
    };
    const property = decl.prop.toLowerCase();
    const value = decl.value.trim();
    if (
      ["scrollbar-width", "scrollbar-color"].includes(property) &&
      value.toLowerCase() !== "auto"
    )
      report(
        "native-scrollbar-override",
        `${property}: ${value} bypasses shared track insets; use the shared WebKit thumb styling.`,
      );

    let parent: AnyNode | undefined = decl.parent;
    while (parent && parent.type !== "rule") parent = parent.parent;
    if (!parent || parent.type !== "rule") return;
    const targets = selectors(parent);
    if (targets.some((selector) => selector.includes("::-webkit-scrollbar"))) {
      const centralGeometry =
        central &&
        targets.every((selector) =>
          /^::-webkit-scrollbar[\w:-]*$/.test(selector),
        );
      const thumbColor =
        targets.every((selector) =>
          selector.includes("::-webkit-scrollbar-thumb"),
        ) && ["background", "background-color"].includes(property);
      if (!centralGeometry && !thumbColor)
        report(
          "shared-scrollbar-geometry",
          "Scrollbar geometry belongs in mainview/styles.css; local rules may only change thumb colour.",
        );
    }
    if (property === "--scrollbar-size" && !(central && targets.includes("*")))
      report(
        "shared-scrollbar-size",
        "Do not override the shared scrollbar size; corner compensation uses it in both axes.",
      );

    if (cardTokens.has(property)) {
      // Keep approved surface tokens translucent too; an opaque token must not
      // silently invalidate every otherwise compliant card.
      const hex = /^#([\da-f]{4}|[\da-f]{8})$/i.exec(value)?.[1];
      const alpha = hex
        ? Number.parseInt(
            hex.length === 4 ? hex[3].repeat(2) : hex.slice(6),
            16,
          )
        : undefined;
      if (alpha === undefined || alpha <= 0 || alpha >= 255)
        report(
          "translucent-card-token",
          `${property} must be a nonzero, translucent #RGBA or #RRGGBBAA colour.`,
        );
    }
    if (!targets.some(isCardSelector)) return;
    if (["background", "background-color"].includes(property)) {
      const token = /^var\((--[\w-]+)\)$/.exec(value)?.[1];
      if (!token || !cardTokens.has(token))
        report(
          "card-surface-token",
          "Normal cards must use an approved translucent surface token (e.g. var(--ds-tile)).",
        );
    }
    if (
      (property === "opacity" && Number(value) !== 1) ||
      (property === "filter" && /opacity\s*\(/i.test(value))
    )
      report(
        "card-content-opacity",
        "Do not fade the entire card; put alpha on its background token, not its text and icons.",
      );
  });
  return issues;
}

type Ast = { type: string; [key: string]: unknown };
const isNode = (value: unknown): value is Ast =>
  !!value && typeof value === "object" && "type" in value;
function visit(node: Ast, fn: (node: Ast) => void) {
  fn(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const child of value) if (isNode(child)) visit(child, fn);
    } else if (isNode(value)) visit(value, fn);
  }
}

/** Catch the common escape hatch: inline paint/opacity on a card element. */
export function lintUiTsx(source: string, file: string): UiStyleIssue[] {
  const issues: UiStyleIssue[] = [];
  const tree = parseScript(source, {
    sourceType: "module",
    plugins: ["typescript", "jsx"],
  });
  visit(tree as unknown as Ast, (node) => {
    if (node.type !== "JSXOpeningElement") return;
    const attrs = (node.attributes as Ast[]).filter(
      (attr) => attr.type === "JSXAttribute",
    );
    const attrName = (attr: Ast) => (attr.name as Ast)?.name;
    const classAttr = attrs.find((attr) => attrName(attr) === "className");
    const surface = attrs.find((attr) => attrName(attr) === "data-ui-surface");
    let card = (surface?.value as Ast)?.value === "card";
    if (isNode(classAttr?.value))
      visit(classAttr.value, (value) => {
        const text =
          value.type === "StringLiteral"
            ? value.value
            : value.type === "TemplateElement"
              ? (value.value as { raw: string }).raw
              : undefined;
        if (
          typeof text === "string" &&
          text.split(/\s+/).some((s) => cardClass.test(s))
        )
          card = true;
      });
    if (!card) return;
    const style = attrs.find((attr) => attrName(attr) === "style");
    if (!style) return;
    const expression = (style.value as Ast)?.expression as Ast | undefined;
    const report = () => {
      const loc = style.loc as { start: { line: number; column: number } };
      issues.push({
        file,
        line: loc.start.line,
        column: loc.start.column + 1,
        rule: "card-inline-paint",
        message:
          "Keep card background/opacity in shared CSS. Opaque or dynamic inline paint cannot be verified.",
      });
    };
    if (expression?.type !== "ObjectExpression") return report();
    for (const prop of expression.properties as Ast[]) {
      const key = prop.key as Ast | undefined;
      const name = key?.name ?? key?.value;
      if (
        prop.type === "SpreadElement" ||
        prop.computed ||
        ["background", "backgroundColor", "opacity", "filter"].includes(
          String(name),
        )
      )
        return report();
    }
  });
  return issues;
}
