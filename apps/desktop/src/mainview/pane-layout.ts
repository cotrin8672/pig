export type SplitAxis = "rows" | "columns";
export type PaneNode =
  | { type: "pane"; id: number }
  | { type: "split"; axis: SplitAxis; children: PaneNode[]; weights: number[] };
export type PaneLayout =
  | "single"
  | "stacked"
  | "weighted"
  | "triple"
  | "columns"
  | "bottomSplit"
  | "grid";
export type PaneRect = { x: number; y: number; width: number; height: number };
export type PaneDivider = {
  path: number[];
  index: number;
  axis: SplitAxis;
  bounds: PaneRect;
  position: number;
};

const pane = (id: number): PaneNode => ({ type: "pane", id });
function group(
  axis: SplitAxis,
  children: PaneNode[],
  weights = children.map(() => 1),
): PaneNode {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  return {
    type: "split",
    axis,
    children,
    weights: weights.map((weight) => weight / total),
  };
}
export function initialPaneTree(layout: PaneLayout): PaneNode {
  switch (layout) {
    case "single":
      return pane(1);
    case "stacked":
      return group("rows", [pane(1), pane(2)]);
    case "weighted":
      return group("rows", [pane(1), pane(2)], [2, 1]);
    case "triple":
      return group("rows", [pane(1), pane(2), pane(3)]);
    case "columns":
      return group("columns", [pane(1), pane(2)]);
    case "bottomSplit":
      return group("rows", [pane(1), group("columns", [pane(2), pane(3)])]);
    case "grid":
      return group("rows", [
        group("columns", [pane(1), pane(2)]),
        group("columns", [pane(3), pane(4)]),
      ]);
  }
}

/** Same-axis siblings share equal space; a different axis splits only the target leaf. */
export function splitPane(
  node: PaneNode,
  id: number,
  newId: number,
  axis: SplitAxis,
): PaneNode {
  if (node.type === "pane")
    return node.id === id ? group(axis, [node, pane(newId)]) : node;
  const index = node.children.findIndex(
    (child) => child.type === "pane" && child.id === id,
  );
  if (node.axis === axis && index >= 0) {
    const children = [...node.children];
    children.splice(index + 1, 0, pane(newId));
    return group(axis, children);
  }
  return {
    ...node,
    children: node.children.map((child) => splitPane(child, id, newId, axis)),
  };
}

export function replacePane(
  node: PaneNode,
  id: number,
  newId: number,
): PaneNode {
  return node.type === "pane"
    ? node.id === id
      ? pane(newId)
      : node
    : {
        ...node,
        children: node.children.map((child) => replacePane(child, id, newId)),
      };
}

export function removePane(node: PaneNode, id: number): PaneNode | undefined {
  if (node.type === "pane") return node.id === id ? undefined : node;
  const children: PaneNode[] = [];
  const weights: number[] = [];
  node.children.forEach((child, index) => {
    const remaining = removePane(child, id);
    if (!remaining) return;
    // Collapse redundant same-axis groups without changing the surviving proportions.
    if (remaining.type === "split" && remaining.axis === node.axis) {
      children.push(...remaining.children);
      weights.push(
        ...remaining.weights.map((weight) => weight * node.weights[index]),
      );
    } else {
      children.push(remaining);
      weights.push(node.weights[index]);
    }
  });
  return children.length === 0
    ? undefined
    : children.length === 1
      ? children[0]
      : group(node.axis, children, weights);
}

export function paneGeometry(tree: PaneNode) {
  const panes: { id: number; bounds: PaneRect }[] = [];
  const dividers: PaneDivider[] = [];
  function visit(node: PaneNode, bounds: PaneRect, path: number[]) {
    if (node.type === "pane") {
      panes.push({ id: node.id, bounds });
      return;
    }
    let position = 0;
    node.children.forEach((child, index) => {
      const weight = node.weights[index];
      visit(
        child,
        node.axis === "rows"
          ? {
              ...bounds,
              y: bounds.y + bounds.height * position,
              height: bounds.height * weight,
            }
          : {
              ...bounds,
              x: bounds.x + bounds.width * position,
              width: bounds.width * weight,
            },
        [...path, index],
      );
      position += weight;
      if (index < node.children.length - 1)
        dividers.push({ path, index, axis: node.axis, bounds, position });
    });
  }
  visit(tree, { x: 0, y: 0, width: 1, height: 1 }, []);
  return { panes, dividers };
}

export function adjacentPane(
  tree: PaneNode,
  id: number,
  direction: "left" | "right" | "up" | "down",
) {
  const panes = paneGeometry(tree).panes;
  const current = panes.find((pane) => pane.id === id)?.bounds;
  if (!current) return;
  const horizontal = direction === "left" || direction === "right";
  const backwards = direction === "left" || direction === "up";
  const start = horizontal ? current.x : current.y;
  const cross = horizontal ? current.y : current.x;
  const extent = horizontal ? current.width : current.height;
  const crossExtent = horizontal ? current.height : current.width;
  return panes
    .filter((pane) => pane.id !== id)
    .map((pane) => {
      const bounds = pane.bounds;
      const otherStart = horizontal ? bounds.x : bounds.y;
      const otherCross = horizontal ? bounds.y : bounds.x;
      const otherExtent = horizontal ? bounds.width : bounds.height;
      const otherCrossExtent = horizontal ? bounds.height : bounds.width;
      const gap = backwards
        ? start - otherStart - otherExtent
        : otherStart - start - extent;
      const overlap =
        Math.min(cross + crossExtent, otherCross + otherCrossExtent) -
        Math.max(cross, otherCross);
      return {
        id: pane.id,
        gap,
        overlap,
        distance:
          gap +
          Math.abs(cross + crossExtent / 2 - otherCross - otherCrossExtent / 2),
      };
    })
    .filter((pane) => pane.gap >= -0.001 && pane.overlap > 0.001)
    .sort((a, b) => a.distance - b.distance)[0]?.id;
}

function minimumSize(node: PaneNode, axis: SplitAxis): number {
  if (node.type === "pane") return axis === "rows" ? 150 : 240;
  const sizes = node.children.map((child) => minimumSize(child, axis));
  return node.axis === axis
    ? sizes.reduce((sum, size) => sum + size, 0)
    : Math.max(...sizes);
}

/** Move just the two adjacent children. Delta is a fraction of this split's extent. */
export function resizePane(
  node: PaneNode,
  path: number[],
  index: number,
  delta: number,
  pixels: number,
): PaneNode {
  if (node.type === "pane") return node;
  if (path.length)
    return {
      ...node,
      children: node.children.map((child, childIndex) =>
        childIndex === path[0]
          ? resizePane(child, path.slice(1), index, delta, pixels)
          : child,
      ),
    };
  const weights = [...node.weights];
  const total = weights[index] + weights[index + 1];
  const before = minimumSize(node.children[index], node.axis) / pixels;
  const after = minimumSize(node.children[index + 1], node.axis) / pixels;
  const fit = Math.min(1, total / (before + after));
  weights[index] = Math.max(
    before * fit,
    Math.min(total - after * fit, weights[index] + delta),
  );
  weights[index + 1] = total - weights[index];
  return { ...node, weights };
}
