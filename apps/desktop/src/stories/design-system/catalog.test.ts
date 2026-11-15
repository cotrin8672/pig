import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "@babel/parser";
import postcss from "postcss";
import { lintUiCss, lintUiTsx } from "../../../scripts/ui-style-rules";
import { decisions, inventory, layers } from "./catalog";

const directory = fileURLToPath(new URL(".", import.meta.url));
const desktop = resolve(directory, "../../..");

test("the catalogue distinguishes existing code from proposals in every layer", () => {
  expect(new Set(layers.map((layer) => layer.name)).size).toBe(layers.length);
  expect(new Set(inventory.map((entry) => entry.name)).size).toBe(
    inventory.length,
  );
  for (const layer of layers)
    expect(inventory.some((entry) => entry.layer === layer.name)).toBe(true);
  for (const entry of inventory) {
    expect(["既存部品", "既存CSS", "構成案"]).toContain(entry.evidence);
    expect(entry.source.length).toBeGreaterThan(0);
    expect(entry.plan.length).toBeGreaterThan(0);
  }
  for (const decision of decisions) {
    expect(decision.use.length).toBeGreaterThan(0);
    expect(decision.avoid.length).toBeGreaterThan(0);
  }
});

test("review styles stay scoped and follow the existing UI rules", () => {
  const file = resolve(directory, "catalog.css");
  const source = readFileSync(file, "utf8");
  postcss.parse(source).walkRules((rule) => {
    for (const selector of rule.selectors)
      expect(selector.startsWith(".ds-review")).toBe(true);
  });
  expect(lintUiCss(source, file)).toEqual([]);
  for (const name of new Bun.Glob("*.tsx").scanSync(directory)) {
    const path = resolve(directory, name);
    expect(lintUiTsx(readFileSync(path, "utf8"), path)).toEqual([]);
  }
});

test("production source never imports the Storybook review", () => {
  const stories = resolve(desktop, "src/stories") + sep;
  for (const name of new Bun.Glob("src/**/*.{ts,tsx}").scanSync(desktop)) {
    if (name.includes(".test.") || resolve(desktop, name).startsWith(stories))
      continue;
    const file = resolve(desktop, name);
    const ast = parse(readFileSync(file, "utf8"), {
      sourceType: "module",
      plugins: ["typescript", "jsx"],
    });
    for (const statement of ast.program.body) {
      if (
        statement.type !== "ImportDeclaration" &&
        statement.type !== "ExportNamedDeclaration" &&
        statement.type !== "ExportAllDeclaration"
      )
        continue;
      const source = statement.source?.value;
      if (source?.startsWith("."))
        expect(
          resolve(dirname(file), source).startsWith(stories),
          `${name} must not import Storybook code`,
        ).toBe(false);
    }
  }
});
