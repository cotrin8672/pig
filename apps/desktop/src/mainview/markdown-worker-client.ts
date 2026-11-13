import MarkdownWorker from "./markdown.worker?worker&inline";
import type { ParsedMarkdown } from "./markdown-engine";
import { createRenderWorkerQueue } from "./render-worker-queue";
export const markdownWorker = createRenderWorkerQueue<
  { text: string },
  ParsedMarkdown
>(async () => new MarkdownWorker());
