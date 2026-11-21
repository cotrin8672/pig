import { ContextMenu, Utils } from "electrobun/bun";
import type {
  EditMenuAction,
  EditMenuCommand,
  EditMenuRequest,
} from "../shared/edit-menu";

const accelerators: Partial<Record<EditMenuAction, string>> = {
  cut: "Ctrl+X",
  copy: "Ctrl+C",
  paste: "Ctrl+V",
  selectAll: "Ctrl+A",
};
const PREFIX = "edit-";

let open:
  | { request: EditMenuRequest; send: (command: EditMenuCommand) => void }
  | undefined;

export function showEditMenu(
  request: EditMenuRequest,
  labels: Record<EditMenuAction, string>,
  send: (command: EditMenuCommand) => void,
) {
  open = { request, send };
  ContextMenu.showContextMenu(
    request.items.map((item) =>
      item === "separator"
        ? { type: "divider" as const }
        : {
            label: labels[item],
            action: `${PREFIX}${item}`,
            enabled: !request.disabled?.includes(item),
            accelerator: accelerators[item],
          },
    ),
  );
}

const isWebUrl = (url: string | undefined): url is string =>
  !!url && /^https?:\/\//i.test(url);

/** Returns false for clicks that belong to another context menu. */
export function handleEditMenuClick(action: string): boolean {
  if (!action.startsWith(PREFIX) || !open) return false;
  const { request, send } = open;
  switch (action.slice(PREFIX.length) as EditMenuAction) {
    case "copy":
      if (request.text) Utils.clipboardWriteText(request.text);
      break;
    case "cut":
      if (request.text) Utils.clipboardWriteText(request.text);
      send({ action: "cut" });
      break;
    case "paste":
      send({ action: "paste", text: Utils.clipboardReadText() ?? "" });
      break;
    case "selectAll":
      send({ action: "selectAll" });
      break;
    case "openLink":
      if (isWebUrl(request.url)) Utils.openExternal(request.url);
      break;
    case "copyLink":
      if (isWebUrl(request.url)) Utils.clipboardWriteText(request.url);
      break;
  }
  return true;
}
