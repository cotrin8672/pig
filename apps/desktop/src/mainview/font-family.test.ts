import { expect, test } from "bun:test";
import { fontFamilyValue } from "./font-family";

test("single font families are quoted safely and keep the original fallback", () => {
  expect(fontFamilyValue("", "var(--font-sans-default)")).toBe(
    "var(--font-sans-default)",
  );
  expect(fontFamilyValue("游ゴシック", "sans-serif")).toBe(
    '"游ゴシック", sans-serif',
  );
  expect(fontFamilyValue('Font, "Special"\\Name', "monospace")).toBe(
    '"Font, \\"Special\\"\\\\Name", monospace',
  );
});
