import { toggleBackdrop } from "../shared/appearance";
import { actionIds, matchesCombo, resolveBindings } from "../shared/keymap";
import { navigate } from "./navigation";
import { updateAppearance } from "./rpc";
import { useStore } from "./store";
import { isTerminalKeyboardEvent } from "./terminal-ui";

export function initShortcuts() {
  const keydown = (event: KeyboardEvent) => {
    if (
      isTerminalKeyboardEvent(event) ||
      useStore.getState().pendingUI.length > 0 ||
      event.defaultPrevented ||
      event.isComposing ||
      event.keyCode === 229 ||
      event.repeat
    )
      return;
    const bindings = resolveBindings(useStore.getState().settings.keybindings);
    const action = actionIds.find((id) => matchesCombo(event, bindings[id]));
    if (!action) return;
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
