import type { McpExtensionOptions } from "@earendil-works/pi-coding-agent";
import { MCP_APP_MAX_BYTES, type McpAppRef } from "../shared/mcp-app";

type Observation = Parameters<
  NonNullable<McpExtensionOptions["onToolResult"]>
>[0];

export const MCP_APP_MAX_READERS = 256;
export const MCP_APP_READ_TIMEOUT_MS = 5_000;
const MAX_RESPONSE_BYTES = 2 * MCP_APP_MAX_BYTES;
const MAX_QUEUED_READS = 32;

/** Raw server HTML, not safe to render. The static sanitizer is a separate trust boundary. */
export type McpAppResource = {
  ref: McpAppRef;
  html: string;
};

class ResourceQueue {
  private active = 0;
  private waiting = new Set<() => void>();

  async run<T>(signal: AbortSignal, action: () => Promise<T>): Promise<T> {
    signal.throwIfAborted();
    if (this.waiting.size >= MAX_QUEUED_READS)
      throw new Error("MCP_APP_QUEUE_FULL");
    await new Promise<void>((resolve, reject) => {
      const cancel = () => {
        this.waiting.delete(start);
        signal.removeEventListener("abort", cancel);
        reject(signal.reason);
      };
      const start = () => {
        if (this.active >= 2) return;
        this.waiting.delete(start);
        signal.removeEventListener("abort", cancel);
        this.active++;
        resolve();
      };
      this.waiting.add(start);
      signal.addEventListener("abort", cancel, { once: true });
      start();
    });
    try {
      signal.throwIfAborted();
      return await action();
    } finally {
      this.active--;
      for (const start of this.waiting) start();
    }
  }
}

// Shared across sessions: a second chat must not double the request budget.
const resources = new ResourceQueue();

function resourceUri(tool: Observation["tool"]) {
  const ui = tool._meta?.ui;
  if (!ui || typeof ui !== "object" || !("resourceUri" in ui)) return;
  const uri = ui.resourceUri;
  if (typeof uri !== "string" || uri.length > 4096 || /\s/.test(uri)) return;
  for (let i = 0; i < uri.length; i++) if (uri.charCodeAt(i) < 0x20) return;
  try {
    const parsed = new URL(uri);
    if (
      parsed.protocol === "ui:" &&
      parsed.host &&
      !parsed.username &&
      !parsed.password
    )
      return uri;
  } catch {
    // Invalid server metadata leaves the ordinary tool result untouched.
  }
}

function htmlResource(
  result: Awaited<ReturnType<Observation["readResource"]>>,
  uri: string,
) {
  if (
    !Array.isArray(result.contents) ||
    result.contents.length !== 1 ||
    Buffer.byteLength(JSON.stringify(result), "utf8") > MAX_RESPONSE_BYTES
  )
    throw new Error("MCP_APP_INVALID_RESOURCE");
  const content = result.contents[0];
  if (
    !content ||
    content.uri !== uri ||
    !/^text\/html\s*;\s*profile\s*=\s*(?:"mcp-app"|mcp-app)\s*$/i.test(
      content.mimeType ?? "",
    ) ||
    !("text" in content) ||
    typeof content.text !== "string" ||
    "blob" in content
  )
    throw new Error("MCP_APP_INVALID_RESOURCE");
  if (Buffer.byteLength(content.text, "utf8") > MCP_APP_MAX_BYTES)
    throw new Error("MCP_APP_TOO_LARGE");
  return content.text;
}

type Reader = {
  toolCallId: string;
  ref: McpAppRef;
  uri: string;
  read: Observation["readResource"];
};
type Flight<T> = {
  controller: AbortController;
  users: number;
  promise: Promise<T>;
};

/** One SDK runtime's readers. Never share them across sessions, reloads or accounts. */
export class McpApps {
  private readonly controller = new AbortController();
  private readonly signal: AbortSignal;
  private readonly readers = new Map<string, Reader>();
  private readonly flights = new Map<string, Flight<McpAppResource>>();
  private readonly staticFlights = new Map<string, Flight<string>>();

  constructor(signal?: AbortSignal) {
    this.signal = signal
      ? AbortSignal.any([signal, this.controller.signal])
      : this.controller.signal;
  }

  readonly observe: NonNullable<McpExtensionOptions["onToolResult"]> = (
    event,
  ) => {
    if (this.signal.aborted || event.isError) return;
    const uri = resourceUri(event.tool);
    if (!uri) return;
    const ref: McpAppRef = {
      version: 1,
      id: crypto.randomUUID(),
      ...(event.tool.title ? { title: event.tool.title.slice(0, 128) } : {}),
    };
    this.readers.set(ref.id, {
      toolCallId: event.toolCallId,
      ref,
      uri,
      read: event.readResource,
    });
    while (this.readers.size > MCP_APP_MAX_READERS) {
      const first = this.readers.keys().next().value;
      if (first !== undefined) this.readers.delete(first);
    }
    return { mcpApp: ref };
  };

  /** Lazy, single-flight read; a caller may cancel without cancelling other callers. */
  read(id: string, toolCallId: string, signal: AbortSignal) {
    signal = AbortSignal.any([signal, this.signal]);
    signal.throwIfAborted();
    const reader = this.readers.get(id);
    if (!reader || reader.toolCallId !== toolCallId)
      return Promise.reject(new Error("MCP_APP_UNAVAILABLE"));
    return this.join(this.flights, id, signal, (flightSignal) => {
      const combined = AbortSignal.any([
        flightSignal,
        AbortSignal.timeout(MCP_APP_READ_TIMEOUT_MS),
      ]);
      return resources.run(combined, async () => {
        const result = await reader.read(reader.uri, {
          signal: combined,
          timeoutMs: MCP_APP_READ_TIMEOUT_MS,
        });
        combined.throwIfAborted();
        return { ref: reader.ref, html: htmlResource(result, reader.uri) };
      });
    });
  }

  /** Sanitized HTML; parsing is shared like the transport. */
  readStatic(id: string, toolCallId: string, signal: AbortSignal) {
    signal = AbortSignal.any([signal, this.signal]);
    signal.throwIfAborted();
    if (this.readers.get(id)?.toolCallId !== toolCallId)
      return Promise.reject(new Error("MCP_APP_UNAVAILABLE"));
    return this.join(this.staticFlights, id, signal, async (flightSignal) => {
      const source = await this.read(id, toolCallId, flightSignal);
      const { staticMcpApp } = await import("./mcp-app-static");
      flightSignal.throwIfAborted();
      const html = await staticMcpApp(source.html);
      flightSignal.throwIfAborted();
      return html;
    });
  }

  private join<T>(
    flights: Map<string, Flight<T>>,
    id: string,
    signal: AbortSignal,
    create: (signal: AbortSignal) => Promise<T>,
  ) {
    let flight = flights.get(id);
    if (!flight) {
      const controller = new AbortController();
      flight = {
        controller,
        users: 0,
        promise: create(AbortSignal.any([controller.signal, this.signal])),
      };
      flights.set(id, flight);
    }
    const joined = flight;
    joined.users++;
    return new Promise<T>((resolve, reject) => {
      let done = false;
      const finish = () => {
        if (done) return false;
        done = true;
        signal.removeEventListener("abort", cancel);
        if (--joined.users === 0) {
          if (flights.get(id) === joined) flights.delete(id);
          joined.controller.abort(new Error("MCP app read no longer needed"));
        }
        return true;
      };
      const cancel = () => {
        if (finish()) reject(signal.reason);
      };
      signal.addEventListener("abort", cancel, { once: true });
      joined.promise.then(
        (result) => {
          if (finish()) resolve(result);
        },
        (error) => {
          if (finish()) reject(error);
        },
      );
    });
  }

  dispose() {
    this.controller.abort(new Error("MCP app runtime disposed"));
    this.readers.clear();
    this.flights.clear();
    this.staticFlights.clear();
  }
}
