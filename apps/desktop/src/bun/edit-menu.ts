import type {
  EditMenuAction,
  EditMenuCommand,
  EditMenuRequest,
} from "../shared/edit-menu";
import { desktopPlatform } from "./desktop-platform";

const accelerators: Partial<Record<EditMenuAction, string>> = {
  cut: "Ctrl+X",
  copy: "Ctrl+C",
  paste: "Ctrl+V",
  selectAll: "Ctrl+A",
};
export function showEditMenu(
  request: EditMenuRequest,
  labels: Record<EditMenuAction, string>,
  send: (command: EditMenuCommand) => void,
  report: (error: unknown) => void,
) {
  const platform = desktopPlatform();
  platform.showMenu(
    request.items.map((item) =>
      item === "separator"
        ? { type: "divider" as const }
        : {
            label: labels[item],
            action: item,
            enabled: !request.disabled?.includes(item),
            accelerator: accelerators[item],
          },
    ),
    (action) => {
      if (!request.items.includes(action as EditMenuAction)) return;
      if (request.disabled?.includes(action as EditMenuAction)) return;
      void select(action as EditMenuAction, request, send).catch(report);
    },
  );
}

const isWebUrl = (url: string | undefined): url is string =>
  !!url && /^https?:\/\//i.test(url);

async function select(
  action: EditMenuAction,
  request: EditMenuRequest,
  send: (command: EditMenuCommand) => void,
) {
  const platform = desktopPlatform();
  switch (action) {
    case "copy":
      if (request.text) await platform.clipboardWriteText(request.text);
      break;
    case "cut":
      if (request.text) await platform.clipboardWriteText(request.text);
      send({ action: "cut" });
      break;
    case "paste":
      send({
        action: "paste",
        text: (await platform.clipboardReadText()) ?? "",
      });
      break;
    case "selectAll":
      send({ action: "selectAll" });
      break;
    case "openLink":
      if (isWebUrl(request.url)) platform.openExternal(request.url);
      break;
    case "copyLink":
      if (isWebUrl(request.url)) await platform.clipboardWriteText(request.url);
      break;
  }
}
