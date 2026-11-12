import { expect, test } from "bun:test";
import { AttachmentReads } from "./attachment-reads";
import { DraftStore } from "./draft-store";

const a = { hostId: "host", sessionId: "a", epoch: 1 };
const b = { ...a, sessionId: "b" };
function fixture() {
  const drafts = new DraftStore();
  const readers: FileReader[] = [];
  const notices: string[] = [];
  const reads = new AttachmentReads(
    drafts,
    (message) => notices.push(message),
    () => {
      const reader = {
        result: "",
        onload: null,
        onerror: null,
        onabort: null,
        readAsDataURL() {},
        abort() {},
      } as unknown as FileReader;
      readers.push(reader);
      return reader;
    },
  );
  const finish = (index: number, data = `image-${index}`) => {
    Object.defineProperty(readers[index], "result", {
      value: `data:image/png;base64,${data}`,
      configurable: true,
    });
    readers[index].onload?.call(
      readers[index],
      {} as ProgressEvent<FileReader>,
    );
  };
  const start = (address = a, name = "image.png") =>
    reads.start(address, new File(["bytes"], name, { type: "image/png" }));
  return { drafts, reads, readers, notices, finish, start };
}

test("pathless native clipboard images participate in pending sends and draft transfers", async () => {
  const f = fixture();
  const pending = Promise.withResolvers<string | null>();
  f.reads.startClipboard(a, () => pending.promise);
  const next = { ...a, epoch: 2 };
  f.drafts.transfer(a, next);
  f.reads.transfer(a, next);
  const claimed = f.reads.claim(next);
  pending.resolve("cG5n");
  expect((await claimed)?.images[0].image).toEqual({
    type: "image",
    mimeType: "image/png",
    data: "cG5n",
  });
  expect(f.drafts.read(next).content.images).toHaveLength(0);
});

test("empty clipboard and cancelled native reads do not leave attachments behind", async () => {
  const f = fixture();
  f.reads.startClipboard(a, async () => null);
  expect((await f.reads.claim(a))?.images).toEqual([]);
  expect(f.reads.pending(a)).toBe(0);
  const pending = Promise.withResolvers<string | null>();
  f.reads.startClipboard(a, () => pending.promise);
  f.reads.cancel(f.reads.read(a)[0].id);
  pending.resolve("cG5n");
  await Promise.resolve();
  expect(f.drafts.read(a).content.images).toHaveLength(0);
});

test("pending reads follow explicit epoch/fork transfers and preserve selection order across late loads", () => {
  const f = fixture();
  f.start();
  f.start();
  f.drafts.edit(b, (content) => ({ ...content, text: "other chat" }));
  const next = { ...a, sessionId: "fork", epoch: 2 };
  f.drafts.transfer(a, next);
  f.reads.transfer(a, next);
  expect(f.reads.read(a)).toHaveLength(0);
  expect(f.reads.read(next)).toHaveLength(2);
  f.finish(1);
  expect(f.reads.read(next)).toHaveLength(1);
  f.finish(0);
  expect(
    f.drafts.read(next).content.images.map(({ image }) => image.data),
  ).toEqual(["image-0", "image-1"]);
  expect(f.drafts.read(a).content.images).toHaveLength(0);
  expect(f.drafts.read(b).content.images).toHaveLength(0);
  expect(f.reads.read(next)).toHaveLength(0);
  expect(f.notices).toHaveLength(0);
});

test("close/restart cancels the read visibly, and a removed image cannot return through a late onload", () => {
  const f = fixture();
  f.start();
  const late = f.readers[0].onload;
  f.drafts.retire(a);
  expect(f.reads.read(a)).toHaveLength(0);
  expect(f.notices[0]).toContain("cancelled");
  late?.call(f.readers[0], {} as ProgressEvent<FileReader>);
  expect(f.drafts.read(a).content.images).toHaveLength(0);
  f.start(b);
  const removed = f.reads.read(b)[0];
  const afterRemove = f.readers[1].onload;
  f.reads.cancel(removed.id);
  afterRemove?.call(f.readers[1], {} as ProgressEvent<FileReader>);
  expect(f.drafts.read(b).content.images).toHaveLength(0);
});

test("read failures leave an actionable error without keeping a pending read forever", () => {
  const f = fixture();
  f.start();
  f.readers[0].onerror?.call(f.readers[0], {} as ProgressEvent<FileReader>);
  expect(f.reads.read(a)[0]).toMatchObject({
    state: "error",
    error: "Could not read image.",
  });
  f.reads.cancel(f.reads.read(a)[0].id);
  expect(f.reads.read(a)).toHaveLength(0);
});
