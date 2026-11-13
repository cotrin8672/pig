import { toggleBackdrop } from "../shared/appearance";
import {
  type ActionId,
  actionIds,
  matchesCombo,
  resolveBindings,
} from "../shared/keymap";
import { adapterBinding } from "./adapter-keymap";
import { navigate } from "./navigation";
import { closePane, createPane, movePaneFocus } from "./pane-state";
import { rpc, updateAppearance } from "./rpc";
import { showError, useStore } from "./store";
import { isTerminalKeyboardEvent } from "./terminal-ui";

export function initShortcuts() {
  const keydown = (event: KeyboardEvent) => {
    const state = useStore.getState();
    if (
      isTerminalKeyboardEvent(event) ||
      event.defaultPrevented ||
      event.isComposing ||
      event.keyCode === 229 ||
      event.repeat
    )
      return;
    const bindings = resolveBindings(state.settings.keybindings);
    const action = actionIds.find(
      (id) => !id.startsWith("composer.") && matchesCombo(event, bindings[id]),
    );
    const explicit =
      action && Object.hasOwn(state.settings.keybindings, action);
    const snapshot = state.active ? state.snapshots[state.active] : undefined;
    const target = event.target instanceof Element ? event.target : null;
    const context = target?.closest("dialog, [role=dialog]")
      ? null
      : target?.closest(".composer")
        ? "composer"
        : target?.closest("input, textarea, select, [contenteditable=true]")
          ? null
          : target?.closest(".session-panel")
            ? "panel"
            : "chat";
    const binding =
      state.page === "chat" && !explicit
        ? adapterBinding(snapshot?.sessionUI, event, context)
        : undefined;
    if (binding && snapshot?.sessionUI) {
      event.preventDefault();
      void rpc.request
        .invokeSessionAction({
          ...snapshot.address,
          generation: snapshot.sessionUI.generation,
          adapterId: binding.adapter,
          commandId: binding.command,
        })
        .catch(showError);
      return;
    }
    if (!action) return;
    if (
      action.startsWith("pane.") &&
      (state.page !== "chat" || context === null || state.searchOpen)
    )
      return;
    event.preventDefault();
    runAction(action);
  };
  window.addEventListener("keydown", keydown);
  return () => window.removeEventListener("keydown", keydown);
}

/** App-level actions, shared by shortcuts and the search palette. */
export function runAction(action: ActionId) {
  switch (action) {
    case "pane.splitRows":
      createPane("rows");
      break;
    case "pane.splitColumns":
      createPane("columns");
      break;
    case "pane.close":
      closePane();
      break;
    case "pane.left":
      movePaneFocus("left");
      break;
    case "pane.right":
      movePaneFocus("right");
      break;
    case "pane.up":
      movePaneFocus("up");
      break;
    case "pane.down":
      movePaneFocus("down");
      break;
    case "appearance.toggleBackdrop":
      updateAppearance(toggleBackdrop);
      break;
    case "navigation.back":
      history.back();
      break;
    case "navigation.forward":
      history.forward();
      break;
    case "settings.open":
      navigate("settings");
      break;
  }
}
