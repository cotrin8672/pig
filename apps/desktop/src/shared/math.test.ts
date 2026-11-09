import { expect, test } from "bun:test";
import { normalizeMath } from "./math";

test("normalizeMath rewrites LaTeX delimiters to remark-math syntax", () => {
  expect(normalizeMath("a \\(x^2\\) b")).toBe("a $x^2$ b");
  expect(normalizeMath("see\n\\[ \\frac{a}{b} \\]\nend")).toBe(
    "see\n\n$$\n\\frac{a}{b}\n$$\n\nend",
  );
  expect(normalizeMath("$y$ and $$z$$")).toBe("$y$ and $$z$$");
});

test("normalizeMath leaves code untouched", () => {
  const code = "```tex\n\\[ x \\]\n```\nand `\\(y\\)` but \\(z\\)";
  expect(normalizeMath(code)).toBe(
    "```tex\n\\[ x \\]\n```\nand `\\(y\\)` but $z$",
  );
});
