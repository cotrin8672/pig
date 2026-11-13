import { parseMarkdown } from "./markdown-engine";
import { serveRenderWorker } from "./render-worker-server";

serveRenderWorker(({ text }: { text: string }) => parseMarkdown(text));
