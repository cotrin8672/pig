import { createRoot } from "react-dom/client";
import { App } from "./App";
import { reloadChatRenderers } from "./chat-renderer-client";
import { registerBuiltinChatRenderers } from "./chat-renderer-registry";
import { piLensRenderer } from "./PiLensRenderer";
import { rpc } from "./rpc";
import "katex/dist/katex.min.css";
import "./styles.css";

registerBuiltinChatRenderers([piLensRenderer]);
const root = document.getElementById("root");
if (root) createRoot(root).render(<App />);

void reloadChatRenderers(() => rpc.request.getChatRendererBundle());
