/** Internal display transport, not a Pi SDK API. No Components or done values cross it. */
export type UIAddress = { sessionId: string; epoch: number; uiId: string };
export type TerminalHostEvent = UIAddress &
  (
    | { type: "open"; title?: string; parentUiId?: string }
    | { type: "data"; seq: number; data: string }
    | { type: "close"; reason: "done" | "cancelled" | "failed" }
  );
export type TerminalClientCommand = UIAddress &
  (
    | { type: "ready" | "resize"; cols: number; rows: number }
    | {
        type: "input";
        inputSeq: number;
        encoding: "text" | "binary";
        data: string;
      }
    | { type: "ack"; seq: number }
    | { type: "cancel" }
  );
// Donor names retained for callers migrating to the addressed transport.
export type TerminalUIEvent = TerminalHostEvent;
export type TerminalUICommand = TerminalClientCommand;
export type TerminalOpenEvent = Extract<TerminalHostEvent, { type: "open" }>;

/** All string limits use UTF-8 bytes, except binary input (one code unit = one byte). */
export const TERMINAL_LIMITS = Object.freeze({
  inputBytes: 64 * 1024,
  bufferedInputBytes: 1024 * 1024,
  outputChunkBytes: 256 * 1024,
  pendingOutputBytes: 1024 * 1024,
  pendingEvents: 1024,
  commandsPerSecond: 2000,
  resizesPerSecond: 120,
  outputEventsPerSecond: 2000,
  readyTimeoutMs: 15_000,
  ackTimeoutMs: 15_000,
  openRequests: 32,
});
const encoder = new TextEncoder();
export function utf8Bytes(data: string): number {
  return encoder.encode(data).byteLength;
}
export function validSequence(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
export function validAddress(value: unknown): value is UIAddress {
  if (!value || typeof value !== "object") return false;
  const a = value as UIAddress;
  return (
    typeof a.sessionId === "string" &&
    a.sessionId.length > 0 &&
    a.sessionId.length <= 256 &&
    typeof a.uiId === "string" &&
    a.uiId.length > 0 &&
    a.uiId.length <= 256 &&
    Number.isSafeInteger(a.epoch) &&
    a.epoch >= 0
  );
}
export function sameAddress(a: UIAddress, b: UIAddress): boolean {
  return (
    a.sessionId === b.sessionId && a.epoch === b.epoch && a.uiId === b.uiId
  );
}
export function terminalAddressKey(a: UIAddress): string {
  return JSON.stringify([a.sessionId, a.epoch, a.uiId]);
}
export function validDimensions(cols: number, rows: number): boolean {
  return (
    Number.isInteger(cols) &&
    cols >= 2 &&
    cols <= 500 &&
    Number.isInteger(rows) &&
    rows >= 2 &&
    rows <= 200
  );
}
export function inputBytes(data: string, encoding: "text" | "binary"): number {
  if (encoding === "text") return utf8Bytes(data);
  for (let i = 0; i < data.length; i++) {
    if (data.charCodeAt(i) > 255)
      throw new TypeError("Invalid binary terminal input");
  }
  return data.length;
}
/** Fixed-window counters retain no per-event history. */
export class TerminalRateLimit {
  private since = 0;
  private count = 0;
  constructor(private readonly maximum: number) {}
  accept(now = performance.now()): boolean {
    if (now - this.since >= 1000) {
      this.since = now;
      this.count = 0;
    }
    return ++this.count <= this.maximum;
  }
}
