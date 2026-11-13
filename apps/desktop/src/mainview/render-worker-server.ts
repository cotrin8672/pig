export function serveRenderWorker<I, O>(process: (input: I) => O | Promise<O>) {
  const endpoint = globalThis as unknown as {
    onmessage: (event: MessageEvent<{ id: number; input: I }>) => void;
    postMessage(value: unknown): void;
  };
  endpoint.postMessage({ ready: true });
  endpoint.onmessage = async ({ data }) => {
    try {
      endpoint.postMessage({ id: data.id, result: await process(data.input) });
    } catch {
      endpoint.postMessage({ id: data.id, error: "Render task failed" });
    }
  };
}
