import { createRoot } from "react-dom/client";
import { App } from "./App";
import { applyPatchRenderer } from "./ApplyPatchRenderer";
import { reloadChatRenderers } from "./chat-renderer-client";
import { registerBuiltinChatRenderers } from "./chat-renderer-registry";
import { piLensRenderer } from "./PiLensRenderer";
import { rpc } from "./rpc";
import "katex/dist/katex.min.css";
import "./styles.css";

// WebView2 opens dropped files itself (a window flashes for .xlsx etc.); only chat panes accept drops.
for (const type of ["dragover", "drop"] as const)
  window.addEventListener(type, (event) => {
    if (event.defaultPrevented || !event.dataTransfer?.types.includes("Files"))
      return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "none";
  });

registerBuiltinChatRenderers([piLensRenderer, applyPatchRenderer]);
const root = document.getElementById("root");
if (root) createRoot(root).render(<App />);

void reloadChatRenderers(() => rpc.request.getChatRendererBundle());
