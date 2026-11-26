import type { RPCSchema } from "./rpc-schema";

type Side = "bun" | "webview";
type Requests<S extends Side> = RPCSchema[S]["requests"];
type Messages<S extends Side> = RPCSchema[S]["messages"];
type Params<T> = T extends { params: infer P } ? P : never;
type Result<T> = T extends { response: infer R } ? R : never;
export type RpcHandlers<S extends Side> = {
  requests: {
    [K in keyof Requests<S>]: (
      params: Params<Requests<S>[K]>,
    ) => Result<Requests<S>[K]> | Promise<Result<Requests<S>[K]>>;
  };
  messages: { [K in keyof Messages<S>]: (payload: Messages<S>[K]) => void };
};

export type RpcPacket =
  | ["request", number, string, unknown]
  | ["reply", number, boolean, unknown]
  | ["message", string, unknown];

function callback(table: object, name: unknown) {
  if (typeof name !== "string" || !Object.hasOwn(table, name)) return;
  return Reflect.get(table, name) as (value: unknown) => unknown;
}

/** Bidirectional RPC over the private native transport. No name is looked up on a prototype. */
export function desktopRpc<L extends Side, R extends Side>(
  handlers: RpcHandlers<L>,
  write: (packet: RpcPacket) => unknown,
  report: (error: unknown) => void = console.error,
  timeoutMs = 600_000,
) {
  type Pending = {
    finish: (ok: boolean, data: unknown) => void;
  };
  const pending = new Map<number, Pending>();
  let seq = 0;
  let closed = false;
  const send = async (packet: RpcPacket) => {
    if (closed) throw new Error("Desktop RPC has disconnected.");
    await write(packet);
  };
  const request = new Proxy(Object.create(null), {
    get: (_, name) => (params: unknown) => {
      if (pending.size >= 512)
        return Promise.reject(new Error("Too many desktop requests."));
      const id = ++seq;
      return new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(
          () => finish(false, `Desktop request ${String(name)} timed out.`),
          timeoutMs,
        );
        function finish(ok: boolean, data: unknown) {
          clearTimeout(timer);
          pending.delete(id);
          if (ok) resolve(data);
          else reject(data instanceof Error ? data : new Error(String(data)));
        }
        pending.set(id, { finish });
        void send(["request", id, String(name), params]).catch((error) =>
          finish(false, error),
        );
      });
    },
  }) as {
    [K in keyof Requests<R>]: (
      params: Params<Requests<R>[K]>,
    ) => Promise<Result<Requests<R>[K]>>;
  };
  const messages = new Proxy(Object.create(null), {
    get: (_, name) => (payload: unknown) => {
      void send(["message", String(name), payload]).catch(report);
    },
  }) as { [K in keyof Messages<R>]: (payload: Messages<R>[K]) => void };
  return {
    request,
    send: messages,
    publish<K extends keyof Messages<R> & string>(
      name: K,
      payload: Messages<R>[K],
    ) {
      void send(["message", name, payload]).catch(report);
    },
    close() {
      closed = true;
      for (const item of pending.values())
        item.finish(false, "Desktop RPC has disconnected.");
    },
    async receive(packet: unknown) {
      if (closed || !Array.isArray(packet)) return;
      const [kind, id, method, value] = packet;
      if (kind === "message") {
        try {
          await callback(handlers.messages, id)?.(method);
        } catch (error) {
          report(error);
        }
      } else if (Number.isSafeInteger(id)) {
        if (kind === "reply" && typeof method === "boolean") {
          pending.get(id)?.finish(method, value);
        } else if (kind === "request") {
          let reply: RpcPacket;
          try {
            const run = callback(handlers.requests, method);
            if (!run) throw new Error("Unknown desktop request.");
            // JSON has no undefined. Restore a missing RPC argument on the receiving end.
            reply = [
              "reply",
              id,
              true,
              await run(value === null ? undefined : value),
            ];
          } catch (error) {
            reply = [
              "reply",
              id,
              false,
              error instanceof Error ? error.message : String(error),
            ];
          }
          await send(reply).catch(report);
        }
      }
    },
  };
}
