import type { ThemedToken } from "shiki/core";
import { createRenderWorkerQueue } from "./render-worker-queue";
import SyntaxWorker from "./syntax.worker?worker&inline";
export const syntaxWorker = createRenderWorkerQueue<
  { text: string; language?: string },
  ThemedToken[][]
>(async () => {
  const worker = new SyntaxWorker();
  let previous: { text: string; language?: string } | undefined;
  return {
    terminate: () => worker.terminate(),
    addEventListener: worker.addEventListener.bind(worker),
    postMessage(value) {
      const { id, input } = value as {
        id: number;
        input: { text: string; language?: string };
      };
      const append =
        previous &&
        previous.language === input.language &&
        input.text.startsWith(previous.text)
          ? input.text.slice(previous.text.length)
          : undefined;
      worker.postMessage({
        id,
        input: append === undefined ? input : { append },
      });
      previous = input;
    },
  };
});
