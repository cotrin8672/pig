/** Native right-click menu for text fields, selections and links. */
export type EditMenuAction =
  | "cut"
  | "copy"
  | "paste"
  | "selectAll"
  | "openLink"
  | "copyLink";
export type EditMenuItem = EditMenuAction | "separator";

export interface EditMenuRequest {
  items: EditMenuItem[];
  disabled?: EditMenuAction[];
  /** Text Copy/Cut put on the clipboard, after the page's own copy handlers. */
  text?: string;
  /** http(s) link under the pointer. */
  url?: string;
}

/** Actions the page applies itself; the clipboard side is done natively. */
export type EditMenuCommand =
  | { action: "cut" }
  | { action: "paste"; text: string }
  | { action: "selectAll" };
