import type { RootContent } from "hast";
import { parseMarkdown } from "./markdown-engine";
import { serveRenderWorker } from "./render-worker-server";

const formulas = new Map<string, RootContent[]>();
serveRenderWorker(
  ({ text, streaming }: { text: string; streaming?: boolean }) =>
    parseMarkdown(text, streaming, streaming ? formulas : undefined),
);
