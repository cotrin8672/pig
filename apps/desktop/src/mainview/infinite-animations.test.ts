import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import postcss from "postcss";

/**
 * Infinite animations run for as long as a chat or tool is live. Keyframes that
 * animate anything but opacity/transform repaint every frame on the main thread
 * (a running shell's box-shadow dot alone used ~1/4 of each frame).
 */
const compositor = new Set([
  "opacity",
  "transform",
  "translate",
  "rotate",
  "scale",
]);
// Measured cheap: a small clipped text/skeleton box, not a large surface.
const measuredCheap = new Set(["thinking-shimmer", "skeleton-shimmer"]);

test("infinite animations only animate compositor properties", () => {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (path.endsWith(".css")) files.push(path);
    }
  };
  walk(import.meta.dir);
  const keyframes = new Map<string, Set<string>>();
  const infinite: { name: string; where: string }[] = [];
  for (const file of files) {
    const root = postcss.parse(readFileSync(file, "utf8"), { from: file });
    root.walkAtRules("keyframes", (rule) => {
      const props = new Set<string>();
      rule.walkDecls((decl) => {
        props.add(decl.prop);
      });
      keyframes.set(rule.params, props);
    });
    root.walkDecls("animation", (decl) => {
      if (/\binfinite\b/.test(decl.value))
        for (const name of decl.value.split(/[\s,]+/))
          infinite.push({ name, where: `${file}:${decl.source?.start?.line}` });
    });
  }
  const violations = infinite.flatMap(({ name, where }) => {
    const props = keyframes.get(name);
    if (!props || measuredCheap.has(name)) return [];
    const bad = [...props].filter((prop) => !compositor.has(prop));
    return bad.length ? [`${name} (${bad.join(", ")}) at ${where}`] : [];
  });
  expect(infinite.length).toBeGreaterThan(0);
  expect(violations).toEqual([]);
});
