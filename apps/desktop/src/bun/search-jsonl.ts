export const INDEX_SLICE_MS = 8;
export const INDEX_READ_BYTES = 8 * 1024 * 1024;
// Return to the I/O loop without Windows' coarse setTimeout(0) timer delay.
export const yieldIndexing = () =>
  new Promise<void>((resolve) => setImmediate(resolve));
export class IndexSourceChanged extends Error {}

export interface JsonlLine {
  text: string;
  /** Absolute byte offset immediately after LF, never a string offset. */
  end: number;
  tail: Buffer;
}

/** Read only a captured byte range. Decode complete lines so split UTF-8 code
 * points are never replaced, and retain at most one unfinished JSONL record. */
export async function* readIndexLines(
  handle: {
    read(
      buffer: Buffer,
      offset: number,
      length: number,
      position: number,
    ): Promise<{ bytesRead: number }>;
  },
  from: number,
  to: number,
  options: {
    tail?: Buffer;
    chunkBytes?: number;
    current?: () => boolean;
    yieldControl?: () => Promise<void>;
    onRead?: (bytes: Buffer) => void;
    shouldDecode?: (line: Buffer) => boolean;
  } = {},
): AsyncGenerator<JsonlLine> {
  const chunkBytes = options.chunkBytes ?? INDEX_READ_BYTES;
  if (!Number.isInteger(chunkBytes) || chunkBytes < 1)
    throw new Error("Invalid indexing chunk size");
  const current = options.current ?? (() => true);
  const yieldControl = options.yieldControl ?? yieldIndexing;
  let position = from,
    started = performance.now();
  let parts: Buffer[] = [],
    length = 0,
    tail = options.tail ?? Buffer.alloc(0);
  while (position < to && current()) {
    const buffer = Buffer.alloc(Math.min(chunkBytes, to - position));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
    if (!current()) return;
    if (!bytesRead)
      throw new IndexSourceChanged(
        "Index source ended before the captured size",
      );
    const bytes = buffer.subarray(0, bytesRead);
    options.onRead?.(bytes);
    let start = 0;
    for (
      let lf = bytes.indexOf(0x0a);
      lf !== -1;
      lf = bytes.indexOf(0x0a, start)
    ) {
      const piece = bytes.subarray(start, lf + 1);
      const complete = parts.length
        ? Buffer.concat([...parts, piece], length + piece.length)
        : piece;
      parts = [];
      length = 0;
      tail =
        complete.length >= 64
          ? Buffer.from(complete.subarray(-64))
          : Buffer.concat([
              tail.subarray(-Math.max(0, 64 - complete.length)),
              complete,
            ]);
      if (!current()) return;
      yield {
        text:
          options.shouldDecode && !options.shouldDecode(complete)
            ? ""
            : complete.subarray(0, -1).toString("utf8"),
        end: position + lf + 1,
        tail,
      };
      start = lf + 1;
      if (performance.now() - started >= INDEX_SLICE_MS) {
        await yieldControl();
        started = performance.now();
      }
    }
    if (start < bytes.length) {
      const rest = bytes.subarray(start);
      parts.push(rest);
      length += rest.length;
    }
    position += bytesRead;
    if (performance.now() - started >= INDEX_SLICE_MS) {
      await yieldControl();
      started = performance.now();
    }
  }
  // An unfinished final record is deliberately not decoded or checkpointed.
}
