import { expect, test } from "bun:test";
import { IndexSourceChanged, readIndexLines } from "./search-jsonl";

function reader(bytes: Buffer, shortRead = Infinity) {
  const calls: { position: number; length: number }[] = [];
  return {
    calls,
    async read(
      buffer: Buffer,
      offset: number,
      length: number,
      position: number,
    ) {
      calls.push({ position, length });
      const bytesRead = Math.max(
        0,
        Math.min(length, shortRead, bytes.length - position),
      );
      bytes.copy(buffer, offset, position, position + bytesRead);
      return { bytesRead };
    },
  };
}

test("chunked JSONL equals whole-buffer decoding at every byte boundary, including UTF-8/CRLF and exact tails", async () => {
  const source = Buffer.from(
    '\n{"text":"設定😀é\\n字"}\r\n' +
      JSON.stringify({ text: "長い😀".repeat(50) }) +
      '\n\n{"unfinished":"😀',
  );
  const end = source.lastIndexOf(10) + 1;
  const expected = source
    .subarray(0, end)
    .toString("utf8")
    .split("\n")
    .slice(0, -1);
  for (let chunkBytes = 1; chunkBytes <= 80; chunkBytes++)
    for (const short of [1, 7, Infinity]) {
      const handle = reader(source, short);
      const lines = await Array.fromAsync(
        readIndexLines(handle, 0, source.length, {
          chunkBytes,
          yieldControl: async () => {},
        }),
      );
      expect(lines.map((line) => line.text)).toEqual(expected);
      let offset = 0;
      for (const line of lines) {
        offset = source.indexOf(10, offset) + 1;
        expect(line.end).toBe(offset);
        expect(line.tail).toEqual(
          source.subarray(Math.max(0, offset - 64), offset),
        );
      }
      expect(
        handle.calls.every(
          (call) =>
            call.length <= chunkBytes &&
            call.position + call.length <= source.length,
        ),
      ).toBe(true);
    }
});

test("byte prefilter equals the old decoded-string prefilter without changing checkpoints or hashed bytes", async () => {
  const source = Buffer.concat([
    Buffer.from(
      '{"role":"user","text":"設定😀"}\n{"role": "user","text":"old prefilter skips spaced keys"}\n',
    ),
    Buffer.from(
      '{"role":"assistant","text":"answer"}\n{"role":"toolResult","text":"ignored😀"}\n',
    ),
    Buffer.from([0xff, 0xe2]),
    Buffer.from('"assistant"\r\n'),
    Buffer.from('"role":"user"\n'),
  ]);
  const expected = source
    .toString("utf8")
    .split("\n")
    .slice(0, -1)
    .map((text) =>
      text.includes('"role":"user"') || text.includes('"assistant"')
        ? text
        : "",
    );
  for (const chunkBytes of [1, 7, 32, 256]) {
    const read: Buffer[] = [];
    const lines = await Array.fromAsync(
      readIndexLines(reader(source), 0, source.length, {
        chunkBytes,
        onRead: (chunk) => {
          read.push(chunk);
        },
        yieldControl: async () => {},
        shouldDecode: (line) =>
          line.includes('"role":"user"') || line.includes('"assistant"'),
      }),
    );
    expect(lines.map((line) => line.text)).toEqual(expected);
    expect(Buffer.concat(read)).toEqual(source);
    for (const line of lines)
      expect(line.tail).toEqual(
        source.subarray(Math.max(0, line.end - 64), line.end),
      );
  }
});

test("resuming uses absolute byte offsets and does not consume bytes appended beyond the captured range", async () => {
  const before = Buffer.from("header😀\n"),
    suffix = Buffer.from("設定\nnext\npartial😀");
  const captured = Buffer.concat([before, suffix]),
    handle = reader(Buffer.concat([captured, Buffer.from("\nlate\n")]));
  const lines = await Array.fromAsync(
    readIndexLines(handle, before.length, captured.length, {
      chunkBytes: 2,
      tail: before,
      yieldControl: async () => {},
    }),
  );
  expect(lines.map((line) => line.text)).toEqual(["設定", "next"]);
  expect(lines.at(-1)?.end).toBe(
    before.length + Buffer.byteLength("設定\nnext\n"),
  );
  expect(lines[0].tail).toEqual(Buffer.concat([before, Buffer.from("設定\n")]));
});

test("the default indexing scheduler services timers before a long record finishes", async () => {
  const bytes = Buffer.from(`${"x".repeat(64 * 1024)}\n`);
  let consumed = 0,
    serviced = false;
  const timer = setTimeout(() => {
    serviced = consumed < bytes.length;
  }, 0);
  try {
    const lines = await Array.fromAsync(
      readIndexLines(reader(bytes), 0, bytes.length, {
        chunkBytes: 1024,
        onRead: (chunk) => {
          consumed += chunk.length;
          const until = performance.now() + 2;
          while (performance.now() < until) {
            /* deterministic CPU work between yields */
          }
        },
      }),
    );
    expect(lines).toHaveLength(1);
    expect(serviced).toBe(true);
  } finally {
    clearTimeout(timer);
  }
});

test("short EOF and I/O failures propagate; cancellation stops reads and unfinished records are not emitted", async () => {
  await expect(
    Array.fromAsync(readIndexLines(reader(Buffer.from("short\n")), 0, 50)),
  ).rejects.toBeInstanceOf(IndexSourceChanged);
  await expect(
    Array.fromAsync(
      readIndexLines(
        {
          read: async () => {
            throw new Error("EIO");
          },
        },
        0,
        50,
      ),
    ),
  ).rejects.toThrow("EIO");
  const stopped = reader(Buffer.from("not read\n"));
  expect(
    await Array.fromAsync(
      readIndexLines(stopped, 0, 9, { current: () => false }),
    ),
  ).toEqual([]);
  expect(stopped.calls).toEqual([]);
  expect(
    await Array.fromAsync(
      readIndexLines(
        reader(Buffer.from("unfinished😀")),
        0,
        Buffer.byteLength("unfinished😀"),
      ),
    ),
  ).toEqual([]);
});
