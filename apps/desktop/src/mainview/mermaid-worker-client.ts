import MermaidWorker from "./mermaid.worker?worker&inline";
import { createRenderWorkerQueue } from "./render-worker-queue";

export const mermaidWorker = createRenderWorkerQueue<string, string>(
  async () => new MermaidWorker(),
);
