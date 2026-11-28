import type { Pointer } from "bun:ffi";
import type { RpcHandlers } from "../shared/desktop-rpc";
import type { Appearance } from "../shared/rpc-schema";
import type { ClientSender } from "./client-hub";

type MaybePromise<T> = T | Promise<T>;
export type WindowEvent =
  | "focus"
  | "blur"
  | "resize"
  | "navigate"
  | "ready"
  | "close"
  | "closeRequested";
export interface DesktopWindow {
  readonly ptr: Pointer | null;
  isAlive(): boolean;
  isMaximized(): boolean;
  isMinimized(): boolean;
  minimize(): void;
  toggleMaximize(): void;
  close(): void;
  applyBackdrop(appearance: Appearance): MaybePromise<void>;
  on(event: WindowEvent, callback: () => void): void;
  send: ClientSender;
  flushDrafts(): Promise<void>;
}

export type MenuItem =
  | { type: "divider" }
  | { action: string; label: string; enabled?: boolean; accelerator?: string };
export interface DesktopPlatform {
  readonly downloads: string;
  readonly version: string;
  readonly installerUpdater?: {
    check(includeNightly: boolean): Promise<string | null>;
    prepare(includeNightly: boolean, version: string): Promise<void>;
    install(): Promise<void>;
  };
  createWindow(
    id: string,
    offset: number,
    handlers: RpcHandlers<"bun">,
  ): DesktopWindow;
  onBeforeQuit(handler: () => boolean): void;
  quit(): void;
  choosePath(kind: "folder" | "json"): Promise<string | undefined>;
  showMessageBox(input: {
    title: string;
    message: string;
    buttons:
      | [retry: string, cancel: string, discard: string]
      | [cancel: string, confirm: string];
    defaultId: number;
    cancelId: number;
  }): Promise<number>;
  showMenu(items: MenuItem[], choose: (action: string) => void): void;
  showNotification(body: string): void;
  openExternal(url: string): boolean;
  openPath(path: string): boolean;
  showItemInFolder(path: string): void;
  clipboardReadText(): MaybePromise<string | null>;
  clipboardWriteText(text: string): MaybePromise<void>;
}

let installed: DesktopPlatform | undefined;
export function installDesktopPlatform(value: DesktopPlatform) {
  if (installed) throw new Error("Desktop platform is already initialized.");
  installed = value;
}
export function desktopPlatform() {
  if (!installed) throw new Error("Desktop platform not initialized.");
  return installed;
}
