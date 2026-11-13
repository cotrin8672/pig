import type { ThemedToken } from "shiki/core";
import { createRenderWorkerQueue } from "./render-worker-queue";
import SyntaxWorker from "./syntax.worker?worker&inline";
export const syntaxWorker = createRenderWorkerQueue<
  { text: string; language?: string },
  ThemedToken[][]
>(async () => new SyntaxWorker());
