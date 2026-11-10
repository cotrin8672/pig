import { createRoot } from "react-dom/client";
import { App } from "./App";
import { reloadChatRenderers } from "./chat-renderer-client";
import { rpc } from "./rpc";
import "katex/dist/katex.min.css";
import "./styles.css";

const root = document.getElementById("root");
if (root) createRoot(root).render(<App />);

void reloadChatRenderers(() => rpc.request.getChatRendererBundle());
