import { defineChatRenderers } from "@pig/chat-renderers";
import * as React from "react";
import * as jsxDevRuntime from "react/jsx-dev-runtime";
import * as jsxRuntime from "react/jsx-runtime";
import {
  installChatRenderers,
  rendererLoadError,
  rendererSnapshot,
} from "./chat-renderer-registry";

type Bundle = { file: string; source: string | null; error?: string };
let request = 0;
let lastSource: string | null | undefined;
async function importRendererModule(
  source: string,
): Promise<{ default: unknown }> {
  // The compiler resolves React to this exact instance, never a second bundled React.
  Object.assign(globalThis, {
    [Symbol.for("pig.chat-renderers")]: {
      react: React,
      jsxRuntime,
      jsxDevRuntime,
      api: { defineChatRenderers },
    },
  });
  const url = URL.createObjectURL(
    new Blob([source], { type: "text/javascript" }),
  );
  try {
    return await import(/* @vite-ignore */ url);
  } finally {
    URL.revokeObjectURL(url);
  }
}
/** Failed or stale reloads leave the last working renderer set installed. */
export async function reloadChatRenderers(
  fetchBundle: () => Promise<Bundle>,
  loadModule = importRendererModule,
): Promise<boolean> {
  const revision = ++request;
  let file = "";
  try {
    const bundle = await fetchBundle();
    if (revision !== request) return false;
    file = bundle.file;
    if (bundle.error) throw new Error(bundle.error);
    if (bundle.source !== null && bundle.source === lastSource) {
      installChatRenderers(rendererSnapshot().renderers, file);
      return true;
    }
    const value =
      bundle.source === null ? [] : (await loadModule(bundle.source)).default;
    if (revision !== request) return false;
    installChatRenderers(value, file);
    lastSource = bundle.source;
    return true;
  } catch (error) {
    if (revision === request) rendererLoadError(file, error);
    return false;
  }
}
