import { useStore } from "./store";
import { isTerminalKeyboardEvent } from "./terminal-ui";

const editable =
  "input, textarea, select, [contenteditable]:not([contenteditable=false])";
// Open popups own the keyboard; never pull focus out from under them.
const popups =
  "dialog[open], [role=dialog], [role=menu], [role=listbox], [aria-modal=true], :popover-open:not([role=tooltip])";
const interactive =
  "button, summary, a[href], [role=button], [role=tab], [role=option], [role=menuitem], [role=separator]";

function composerInput() {
  const { page, activePane } = useStore.getState();
  if (page !== "chat") return;
  const input = document.querySelector<HTMLTextAreaElement>(
    `[data-pane-id="${activePane}"] .composer textarea`,
  );
  return input && !input.disabled && !input.readOnly && input.checkVisibility()
    ? input
    : undefined;
}

function popupOpen() {
  for (const element of document.querySelectorAll(popups))
    if (!element.closest(".composer") && element.checkVisibility()) return true;
  return false;
}

function focusComposer() {
  const input = composerInput();
  if (!input || input === document.activeElement) return false;
  input.focus({ preventScroll: true });
  return true;
}

/**
 * Typing anywhere in a chat starts a message. The editor is also kept focused
 * while nothing else needs the keyboard: an IME only converts keys sent to a
 * focused editor, so focusing on the first keydown would type "i", not "い".
 */
export function initTypeToCompose() {
  const keydown = (event: KeyboardEvent) => {
    const target = event.target instanceof Element ? event.target : null;
    if (
      event.defaultPrevented ||
      event.isComposing ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      event.key.length !== 1 ||
      isTerminalKeyboardEvent(event) ||
      target?.closest(editable) ||
      (event.key === " " && target?.closest(interactive)) ||
      popupOpen()
    )
      return;
    // No preventDefault: the browser delivers this key to the newly focused editor.
    focusComposer();
  };
  // Pointer clicks on transcript or plain buttons leave focus where an IME is
  // off. Return it to the editor unless the click selected text or opened UI.
  const pointerup = () =>
    requestAnimationFrame(() => {
      const active = document.activeElement;
      if (
        !document.hasFocus() ||
        active?.closest(editable) ||
        active?.closest("[data-terminal-ui]") ||
        active?.getAttribute("aria-expanded") === "true" ||
        !document.getSelection()?.isCollapsed ||
        popupOpen()
      )
        return;
      focusComposer();
    });
  const windowFocus = () => {
    // Focusing the editor would discard a transcript selection.
    if (
      document.activeElement === document.body &&
      document.getSelection()?.isCollapsed !== false &&
      !popupOpen()
    )
      focusComposer();
  };
  window.addEventListener("keydown", keydown);
  window.addEventListener("pointerup", pointerup);
  window.addEventListener("focus", windowFocus);
  return () => {
    window.removeEventListener("keydown", keydown);
    window.removeEventListener("pointerup", pointerup);
    window.removeEventListener("focus", windowFocus);
  };
}
