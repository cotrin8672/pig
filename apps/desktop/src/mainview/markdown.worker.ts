import { parseMarkdown } from "./markdown-engine";
import { serveRenderWorker } from "./render-worker-server";

serveRenderWorker(
  ({ text, streaming }: { text: string; streaming?: boolean }) =>
    parseMarkdown(text, streaming),
);
