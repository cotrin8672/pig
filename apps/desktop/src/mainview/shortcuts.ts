import type { ActionKeymap } from "../../../../packages/config/src";
import { toggleBackdrop } from "../shared/appearance";
import {
  type ActionId,
  actionIds,
  comboFromEvent,
  isTypingCombo,
  matchesCombo,
  resolveBindings,
  sequenceStep,
  sequenceTimeoutMs,
} from "../shared/keymap";
import { adapterBindings } from "./adapter-keymap";
import { navigate } from "./navigation";
import { closePane, createPane, movePaneFocus } from "./pane-state";
import { rpc, updateAppearance } from "./rpc";
import { showError, useStore } from "./store";
import { isTerminalKeyboardEvent } from "./terminal-ui";

type Snapshot = ReturnType<typeof useStore.getState>["snapshots"][string];
type Keymap = ActionKeymap | ReturnType<typeof adapterBindings>[number];

const editable = "input, textarea, select, [contenteditable=true]";
function keyContext(target: Element | null) {
  if (target?.closest("dialog, [role=dialog]")) return null;
  if (target?.closest(".composer")) return "composer";
  if (target?.closest(editable)) return null;
  return target?.closest(".session-panel") ? "panel" : "chat";
}

function runKeymap(keymap: Keymap, snapshot: Snapshot | undefined) {
  if ("action" in keymap) runAction(keymap.action as ActionId);
  else if (snapshot?.sessionUI)
    void rpc.request
      .invokeSessionAction({
        ...snapshot.address,
        generation: snapshot.sessionUI.generation,
        adapterId: keymap.adapter,
        commandId: keymap.command,
      })
      .catch(showError);
}

export function initShortcuts() {
  // Keys typed so far of a multi-key sequence such as "<leader> p".
  let pending = "";
  let timer: ReturnType<typeof setTimeout> | undefined;
  const reset = () => {
    pending = "";
    clearTimeout(timer);
  };
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
    const combo = comboFromEvent(event);
    // A bare modifier press must not cancel a pending sequence.
    if (!combo) return;
    const bindings = resolveBindings(state.settings.keybindings);
    const action = actionIds.find(
      (id) => !id.startsWith("composer.") && matchesCombo(event, bindings[id]),
    );
    const explicit =
      action && Object.hasOwn(state.settings.keybindings, action);
    const snapshot = state.active ? state.snapshots[state.active] : undefined;
    const target = event.target instanceof Element ? event.target : null;
    const context = keyContext(target);
    const chat = state.page === "chat";
    const typing = !!target?.closest(`.composer, ${editable}`);
    const blocked = (id: ActionId) =>
      id.startsWith("pane.") && (!chat || context === null || state.searchOpen);
    // Keys set in the settings UI beat TS config keys.
    const candidates: Keymap[] =
      pending || !explicit
        ? [
            ...state.actionKeymaps.filter((keymap) =>
              keymap.when
                ? chat && keymap.when === context
                : !(typing && isTypingCombo(keymap.keys.split(" ")[0])),
            ),
            ...(chat ? adapterBindings(snapshot?.sessionUI, context) : []),
          ]
        : [];
    const step = sequenceStep(
      pending,
      combo,
      candidates.map((keymap) => keymap.keys),
    );
    const wasPending = pending !== "";
    reset();
    if (step && "pending" in step) {
      event.preventDefault();
      pending = step.pending;
      timer = setTimeout(reset, sequenceTimeoutMs);
      return;
    }
    const binding =
      step && candidates.find((keymap) => keymap.keys === step.match);
    // A key that breaks a sequence only cancels it.
    if (binding || wasPending) {
      event.preventDefault();
      if (
        binding &&
        !("action" in binding && blocked(binding.action as ActionId))
      )
        runKeymap(binding, snapshot);
      return;
    }
    if (!action || blocked(action)) return;
    event.preventDefault();
    runAction(action);
  };
  window.addEventListener("keydown", keydown);
  return () => {
    reset();
    window.removeEventListener("keydown", keydown);
  };
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
    case "search.open":
      useStore.setState({ searchOpen: true });
      break;
  }
}
