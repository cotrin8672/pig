import { toggleBackdrop } from "../shared/appearance";
import {
  actionIds,
  configReloadBinding,
  matchesCombo,
  resolveBindings,
} from "../shared/keymap";
import { adapterBinding } from "./adapter-keymap";
import { navigate } from "./navigation";
import { rpc, updateAppearance } from "./rpc";
import { showError, useStore } from "./store";

export function initShortcuts() {
  const keydown = (event: KeyboardEvent) => {
    if (
      useStore.getState().pendingUI.length > 0 ||
      event.defaultPrevented ||
      event.isComposing ||
      event.keyCode === 229 ||
      event.repeat
    )
      return;
    const state = useStore.getState();
    const bindings = resolveBindings(state.settings.keybindings);
    const matches = actionIds.filter((id) => matchesCombo(event, bindings[id]));
    const action =
      matches.find((id) => Object.hasOwn(state.settings.keybindings, id)) ??
      matches[0];
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
    if (!action) {
      if (
        matchesCombo(event, configReloadBinding) &&
        !target?.closest("dialog, [role=dialog]") &&
        !document.querySelector(
          'dialog[open], [role="dialog"][aria-modal="true"]',
        )
      ) {
        event.preventDefault();
        void rpc.request.reloadAdapterConfig().catch(showError);
      }
      return;
    }
    event.preventDefault();
    switch (action) {
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
  };
  window.addEventListener("keydown", keydown);
  return () => window.removeEventListener("keydown", keydown);
}
