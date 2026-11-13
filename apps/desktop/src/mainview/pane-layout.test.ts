import { expect, test } from "bun:test";
import {
  adjacentPane,
  initialPaneTree,
  paneGeometry,
  removePane,
  replacePane,
  resizePane,
  splitPane,
} from "./pane-layout";

for (const axis of ["rows", "columns"] as const) {
  test(`repeated ${axis} splits equally divide siblings without reordering them`, () => {
    const two = splitPane(initialPaneTree("single"), 1, 2, axis);
    const three = splitPane(two, 1, 3, axis);
    expect(three.type).toBe("split");
    if (three.type !== "split") throw Error("Expected split");
    expect(three.axis).toBe(axis);
    expect(three.children).toEqual([
      { type: "pane", id: 1 },
      { type: "pane", id: 3 },
      { type: "pane", id: 2 },
    ]);
    expect(three.weights).toEqual([1 / 3, 1 / 3, 1 / 3]);
    const four = splitPane(resizePane(three, [], 0, 0.05, 1500), 2, 4, axis);
    expect(four.type === "split" && four.weights).toEqual([
      0.25, 0.25, 0.25, 0.25,
    ]);
  });

  test(`${axis} then opposite axis splits only the focused pane`, () => {
    const first = splitPane(initialPaneTree("single"), 1, 2, axis);
    const tree = splitPane(first, 2, 3, axis === "rows" ? "columns" : "rows");
    const original = paneGeometry(first).panes[0];
    const result = paneGeometry(tree);
    expect(result.panes[0]).toEqual(original);
    expect(result.dividers).toHaveLength(2);
    expect(tree.type === "split" && tree.weights).toEqual([0.5, 0.5]);
    const [, b, c] = result.panes;
    if (axis === "rows") {
      expect(b.bounds).toEqual({ x: 0, y: 0.5, width: 0.5, height: 0.5 });
      expect(c.bounds).toEqual({ x: 0.5, y: 0.5, width: 0.5, height: 0.5 });
    } else {
      expect(b.bounds).toEqual({ x: 0.5, y: 0, width: 0.5, height: 0.5 });
      expect(c.bounds).toEqual({ x: 0.5, y: 0.5, width: 0.5, height: 0.5 });
    }
  });
}

test("a split inside a nested group equalizes that group only", () => {
  const tree = splitPane(initialPaneTree("bottomSplit"), 2, 4, "columns");
  const { panes } = paneGeometry(tree);
  expect(panes[0].bounds).toEqual({ x: 0, y: 0, width: 1, height: 0.5 });
  expect(panes.slice(1).map(({ bounds }) => bounds.width)).toEqual([
    1 / 3,
    1 / 3,
    1 / 3,
  ]);
});

test("resizing affects only the adjacent pair and respects minimum sizes", () => {
  const tree = initialPaneTree("triple");
  const resized = resizePane(tree, [], 0, 0.1, 900);
  expect(resized.type).toBe("split");
  if (resized.type !== "split") throw Error("Expected split");
  expect(resized.weights[0]).toBeCloseTo(1 / 3 + 0.1);
  expect(resized.weights[1]).toBeCloseTo(1 / 3 - 0.1);
  expect(resized.weights[2]).toBe(1 / 3);
  const clamped = resizePane(tree, [], 0, 100, 900);
  expect(clamped.type === "split" && clamped.weights[1]).toBeCloseTo(150 / 900);
});

test("nested resizing leaves the outer group unchanged, including in a small viewport", () => {
  const tree = initialPaneTree("bottomSplit");
  const resized = resizePane(tree, [1], 0, -0.1, 1000);
  expect(paneGeometry(resized).panes[0]).toEqual(paneGeometry(tree).panes[0]);
  expect(paneGeometry(resized).panes[1].bounds.width).toBeCloseTo(0.4);
  const small = paneGeometry(resizePane(tree, [1], 0, -100, 200));
  expect(
    small.panes.every(({ bounds }) => bounds.width > 0 && bounds.height > 0),
  ).toBe(true);
});

test("closing a nested pane expands its sibling without changing the outer orientation", () => {
  const tree = removePane(initialPaneTree("bottomSplit"), 3);
  if (!tree) throw Error("Expected surviving panes");
  expect(tree).toEqual(initialPaneTree("stacked"));
  expect(removePane(tree, 2)).toEqual(initialPaneTree("single"));
  expect(removePane(initialPaneTree("single"), 1)).toBeUndefined();
});

test("closing collapses redundant same-axis groups and preserves proportions", () => {
  const nested = splitPane(initialPaneTree("bottomSplit"), 2, 4, "rows");
  const remaining = removePane(nested, 3);
  if (!remaining) throw Error("Expected surviving panes");
  expect(remaining.type === "split" && remaining.weights).toEqual([
    0.5, 0.25, 0.25,
  ]);
  expect(splitPane(remaining, 2, 3, "rows").type).toBe("split");
  expect(
    paneGeometry(splitPane(remaining, 2, 3, "rows")).panes.map(
      ({ bounds }) => bounds.height,
    ),
  ).toEqual([0.25, 0.25, 0.25, 0.25]);
});

test("changing sessions preserves the split structure and sizes", () => {
  const tree = replacePane(initialPaneTree("weighted"), 2, 4);
  expect(paneGeometry(tree).panes.map(({ id }) => id)).toEqual([1, 4]);
  expect(tree.type === "split" && tree.weights).toEqual([2 / 3, 1 / 3]);
});

test("directional focus follows adjacent panes, not diagonal ones", () => {
  const grid = initialPaneTree("grid");
  expect(adjacentPane(grid, 1, "right")).toBe(2);
  expect(adjacentPane(grid, 2, "down")).toBe(4);
  expect(adjacentPane(grid, 4, "left")).toBe(3);
  expect(adjacentPane(grid, 3, "up")).toBe(1);
  expect(adjacentPane(grid, 1, "left")).toBeUndefined();
  const nested = initialPaneTree("bottomSplit");
  expect(adjacentPane(nested, 1, "left")).toBeUndefined();
  expect(adjacentPane(nested, 3, "up")).toBe(1);
});
