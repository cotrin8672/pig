import { expect, test } from "bun:test";
import { classify, npmName } from "./packages";

test("classify mirrors pi.dev keyword badges", () => {
  expect(classify(["pi-package", "Extension", "skills"])).toEqual([
    "extension",
    "skill",
  ]);
  expect(classify(["pi-theme", "prompts"])).toEqual(["theme", "prompt"]);
  expect(classify(["pi-package"])).toEqual([]);
  expect(classify(undefined)).toEqual([]);
});

test("npmName strips the npm: prefix and version", () => {
  expect(npmName("npm:pi-mcp-adapter")).toBe("pi-mcp-adapter");
  expect(npmName("npm:pi-mcp-adapter@7.0.1")).toBe("pi-mcp-adapter");
  expect(npmName("npm:@scope/pkg@^1.2")).toBe("@scope/pkg");
  expect(npmName("npm:@scope/pkg")).toBe("@scope/pkg");
  expect(npmName("git:github.com/a/b@v1")).toBeUndefined();
  expect(npmName("./local")).toBeUndefined();
});
