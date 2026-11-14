import type { RPCSchema } from "../shared/rpc-schema";
import type { RuntimeEvent } from "../shared/runtime-contract";
import { createRuntimeDeltaEncoder } from "./snapshot-delta";

export type ClientMessages = RPCSchema["webview"]["messages"];
export type ClientSender = <K extends keyof ClientMessages>(
  name: K,
  payload: ClientMessages[K],
) => void;

type Client = {
  send: ClientSender;
  /** Delta bases describe what this client has received, so each needs its own. */
  encode: ReturnType<typeof createRuntimeDeltaEncoder>;
};

/** Delivers host publications to every connected UI (one entry per window). */
export class ClientHub {
  private readonly clients = new Map<string, Client>();
  add(id: string, send: ClientSender) {
    if (this.clients.has(id)) throw new Error(`Duplicate UI client ${id}`);
    this.clients.set(id, { send, encode: createRuntimeDeltaEncoder() });
  }
  remove(id: string) {
    this.clients.delete(id);
  }
  /** A reloaded page has no delta bases; send it self-contained snapshots again. */
  reset(id: string) {
    const client = this.clients.get(id);
    if (client) client.encode = createRuntimeDeltaEncoder();
  }
  get size() {
    return this.clients.size;
  }
  ids() {
    return [...this.clients.keys()];
  }
  broadcast<K extends keyof ClientMessages>(
    name: K,
    payload: ClientMessages[K],
  ) {
    for (const [id, client] of this.clients)
      this.deliver(id, client, name, payload);
  }
  to<K extends keyof ClientMessages>(
    id: string,
    name: K,
    payload: ClientMessages[K],
  ) {
    const client = this.clients.get(id);
    if (client) this.deliver(id, client, name, payload);
  }
  runtime(event: RuntimeEvent) {
    for (const [id, client] of this.clients)
      this.deliver(id, client, "runtimeEvent", client.encode(event));
  }
  private deliver<K extends keyof ClientMessages>(
    id: string,
    client: Client,
    name: K,
    payload: ClientMessages[K],
  ) {
    // One closing window must not stop delivery to the others.
    try {
      client.send(name, payload);
    } catch (error) {
      console.error(`Cannot deliver ${String(name)} to UI client ${id}`, error);
    }
  }
}
