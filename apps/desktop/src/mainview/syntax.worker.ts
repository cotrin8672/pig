import { serveRenderWorker } from "./render-worker-server";
import { tokenizeCode } from "./syntax-engine";

type Source = { text: string; language?: string };
let previous: Source | undefined;
serveRenderWorker((input: Source | { append: string }) => {
  if ("append" in input) {
    if (!previous) throw new Error("Missing syntax source");
    previous = {
      text: previous.text + input.append,
      language: previous.language,
    };
  } else previous = input;
  return tokenizeCode(previous.text, previous.language);
});
