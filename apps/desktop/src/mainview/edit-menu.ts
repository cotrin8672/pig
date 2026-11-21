import type {
  EditMenuAction,
  EditMenuCommand,
  EditMenuItem,
  EditMenuRequest,
} from "../shared/edit-menu";

/*
 * The WebView's own context menu stays off (it offers reload/inspect and opens
 * links inside the app). Text fields, selections and links get a native menu
 * instead; the clipboard is read and written by the host, and the page applies
 * cut / paste / select-all through the same events as the keyboard shortcuts.
 */

type Field = HTMLInputElement | HTMLTextAreaElement | HTMLElement;
const textInputs = /^(?:text|search|url|email|tel|password|number)?$/;

function editableOf(node: Element): Field | undefined {
  const field = node.closest<HTMLElement>(
    "textarea, input, [contenteditable]:not([contenteditable='false'])",
  );
  if (field instanceof HTMLInputElement && !textInputs.test(field.type))
    return undefined;
  return field ?? undefined;
}
const isTextControl = (
  field: Field,
): field is HTMLInputElement | HTMLTextAreaElement =>
  field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement;
const readOnly = (field: Field) =>
  isTextControl(field) ? field.readOnly || field.disabled : false;

function selectedText(field: Field | undefined): string {
  if (field && isTextControl(field) && field.type !== "password")
    return field.value.slice(
      field.selectionStart ?? 0,
      field.selectionEnd ?? 0,
    );
  if (field && isTextControl(field)) return "";
  return window.getSelection()?.toString() ?? "";
}

/** What Ctrl+C would copy: the page's copy handlers (e.g. folded pastes) first. */
function copiedText(node: Element, field: Field | undefined): string {
  const selected = selectedText(field);
  if (!selected) return "";
  const data = new DataTransfer();
  const event = new ClipboardEvent("copy", {
    clipboardData: data,
    bubbles: true,
    cancelable: true,
  });
  node.dispatchEvent(event);
  return event.defaultPrevented ? data.getData("text/plain") : selected;
}

function linkOf(node: Element): string | undefined {
  const href = node.closest("a[href]")?.getAttribute("href");
  return href && /^https?:\/\//i.test(href) ? href : undefined;
}

/** Pure part of the menu decision, kept separate for tests. */
export function editMenuRequest(input: {
  editable: boolean;
  readOnly: boolean;
  selection: string;
  copied: string;
  url?: string;
}): EditMenuRequest | undefined {
  const items: EditMenuItem[] = [];
  const disabled: EditMenuAction[] = [];
  if (input.url) items.push("openLink", "copyLink");
  if (input.editable) {
    if (items.length) items.push("separator");
    items.push("cut", "copy", "paste", "separator", "selectAll");
    if (!input.selection || input.readOnly) disabled.push("cut");
    if (!input.selection) disabled.push("copy");
    if (input.readOnly) disabled.push("paste");
  } else if (input.selection) {
    if (items.length) items.push("separator");
    items.push("copy");
  }
  if (!items.length) return undefined;
  return {
    items,
    ...(disabled.length ? { disabled } : {}),
    ...(input.copied ? { text: input.copied } : {}),
    ...(input.url ? { url: input.url } : {}),
  };
}

let target: { node: Element; field?: Field } | undefined;

export function initEditMenu(show: (request: EditMenuRequest) => void) {
  const open = (event: MouseEvent) => {
    // Image menus and other custom menus stop the event before it gets here.
    event.preventDefault();
    if (!(event.target instanceof Element)) return;
    const node = event.target;
    const field = editableOf(node);
    const selection = selectedText(field);
    const request = editMenuRequest({
      editable: !!field,
      readOnly: !!field && readOnly(field),
      selection,
      copied: copiedText(node, field),
      url: linkOf(node),
    });
    target = request ? { node, field } : undefined;
    if (request) show(request);
  };
  window.addEventListener("contextmenu", open);
  return () => window.removeEventListener("contextmenu", open);
}

export function runEditMenuCommand(command: EditMenuCommand) {
  const field = target?.field;
  if (!field?.isConnected) return;
  field.focus();
  switch (command.action) {
    case "selectAll":
      if (isTextControl(field)) field.select();
      else document.execCommand("selectAll");
      return;
    case "cut":
      // The host already put the text on the clipboard.
      document.execCommand("delete");
      return;
    case "paste": {
      // Same path as Ctrl+V, so folded pastes and clipboard images still work.
      const data = new DataTransfer();
      if (command.text) data.setData("text/plain", command.text);
      const event = new ClipboardEvent("paste", {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      });
      field.dispatchEvent(event);
      if (!event.defaultPrevented && command.text)
        document.execCommand("insertText", false, command.text);
    }
  }
}
