import type { PaneNode } from "./pane-layout";

// shortcut: one layout per webview profile, until per-window restore is needed.
export const PANE_WORKSPACE_KEY = "pig.pane-workspace";

type SavedWorkspace = {
  paneTree: PaneNode;
  activePane: number;
  panes: Record<number, { sessionId?: string }>;
};

function validTree(node: unknown, ids: Set<number>): node is PaneNode {
  if (!node || typeof node !== "object") return false;
  const value = node as PaneNode;
  if (value.type === "pane") {
    if (!Number.isSafeInteger(value.id) || value.id < 1 || ids.has(value.id))
      return false;
    ids.add(value.id);
    return true;
  }
  return (
    value.type === "split" &&
    (value.axis === "rows" || value.axis === "columns") &&
    Array.isArray(value.children) &&
    value.children.length >= 2 &&
    Array.isArray(value.weights) &&
    value.weights.length === value.children.length &&
    value.weights.every((w) => typeof w === "number" && w > 0 && w < 1) &&
    Math.abs(value.weights.reduce((sum, w) => sum + w, 0) - 1) < 1e-9 &&
    value.children.every((child) => validTree(child, ids))
  );
}

export function loadPaneWorkspace(): SavedWorkspace | undefined {
  try {
    const raw = globalThis.localStorage?.getItem(PANE_WORKSPACE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw) as SavedWorkspace;
    const ids = new Set<number>();
    if (!validTree(saved?.paneTree, ids) || !ids.has(saved.activePane)) return;
    const sessions = new Set<string>();
    const panes: SavedWorkspace["panes"] = {};
    ids.delete(saved.activePane);
    for (const id of [saved.activePane, ...ids]) {
      const sessionId = saved.panes?.[id]?.sessionId;
      if (
        typeof sessionId === "string" &&
        sessionId &&
        !sessions.has(sessionId)
      ) {
        sessions.add(sessionId);
        panes[id] = { sessionId };
      } else panes[id] = {};
    }
    return { paneTree: saved.paneTree, activePane: saved.activePane, panes };
  } catch {
    // An invalid or inaccessible cache must not block startup.
    return;
  }
}

export function savePaneWorkspace({
  paneTree,
  activePane,
  panes,
}: SavedWorkspace) {
  if (!panes[activePane]) return; // Closing the selected pane hasn't moved focus yet.
  try {
    const saved: SavedWorkspace = { paneTree, activePane, panes: {} };
    for (const [id, { sessionId }] of Object.entries(panes))
      if (sessionId) saved.panes[Number(id)] = { sessionId };
    globalThis.localStorage?.setItem(PANE_WORKSPACE_KEY, JSON.stringify(saved));
  } catch {
    // Storage is optional; the live workspace stays usable.
  }
}
