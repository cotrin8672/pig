import { serveRenderWorker } from "./render-worker-server";
import { tokenizeCode } from "./syntax-engine";

serveRenderWorker(({ text, language }: { text: string; language?: string }) =>
  tokenizeCode(text, language),
);
