import type { StatisticsCommand, StatisticsReply } from "./contracts";
import { StatisticsStore } from "./store";

// SAFETY: this entrypoint runs only inside a Bun Worker, never in a WebView.
const port = self as unknown as {
  onmessage: ((event: MessageEvent<StatisticsCommand>) => void) | null;
  postMessage: (message: StatisticsReply) => void;
  close: () => void;
};
let store: StatisticsStore | undefined;
port.onmessage = ({ data }) => {
  try {
    if (data.type === "open") {
      if (store) throw new Error("Already open");
      store = new StatisticsStore(data.file);
      port.postMessage({ type: "ready" });
      return;
    }
    if (!store) throw new Error("Not open");
    if (data.type === "query") {
      port.postMessage({
        type: "snapshot",
        id: data.id,
        data: store.snapshot(data.period),
      });
      return;
    }
    if (data.type === "batch") store.save(data.events, data.dropped);
    if (data.type === "forget") store.forget(data.owner);
    if (data.type === "close") store.close();
    port.postMessage({ type: "ack", id: data.id });
    if (data.type === "close") port.close();
  } catch {
    // Exception messages may contain paths or arbitrary driver input.
    port.postMessage({ type: "error", code: "storage" });
    store?.close();
    port.close();
  }
};
