import { expect, test } from "bun:test";
import { AttachmentReads, imageLimitMessage } from "./attachment-reads";
import type { DraftAddress } from "./draft-store";
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
  const start = (address: DraftAddress = a, name = "image.png") =>
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
  const claimed = f.reads.claim(next)?.result;
  pending.resolve("cG5n");
  expect((await claimed)?.images[0].image).toEqual({
    type: "image",
    mimeType: "image/png",
    data: "cG5n",
  });
  expect(f.drafts.read(next).content.images).toHaveLength(0);
});

test("empty clipboard fails visibly without a flashing placeholder or an empty send", async () => {
  const f = fixture();
  f.reads.startClipboard(a, async () => null);
  expect(f.reads.read(a)[0].preview).toBe(false);
  const claimed = f.reads.claim(a)?.result;
  await expect(claimed).rejects.toThrow("No image could be read");
  expect(f.reads.pending(a)).toBe(0);
  expect(f.drafts.read(a).content.images).toHaveLength(0);
});

test("cancelled native reads do not leave attachments behind", async () => {
  const f = fixture();
  const pending = Promise.withResolvers<string | null>();
  f.reads.startClipboard(a, () => pending.promise);
  f.reads.cancel(f.reads.read(a)[0].id);
  pending.resolve("cG5n");
  await Promise.resolve();
  expect(f.drafts.read(a).content.images).toHaveLength(0);
});

test("empty, rejected and oversized clipboard probes notify without leaving attachments", async () => {
  for (const load of [
    async () => null,
    async () => {
      throw new Error("clipboard unavailable");
    },
    () => {
      throw new Error("native probe failed");
    },
    async () => "a".repeat(4.5 * 1024 * 1024 + 1),
  ]) {
    const f = fixture();
    f.reads.startClipboard(a, load);
    expect(f.reads.read(a)[0].preview).toBe(false);
    await Bun.sleep(0);
    expect(f.reads.read(a)).toHaveLength(0);
    expect(f.notices).toHaveLength(1);
    expect(f.drafts.read(a).content.images).toHaveLength(0);
  }
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

test("read failures notify without leaving a pending read or an inline error", () => {
  const f = fixture();
  f.start();
  f.readers[0].onerror?.call(f.readers[0], {} as ProgressEvent<FileReader>);
  expect(f.reads.read(a)).toHaveLength(0);
  expect(f.notices).toEqual(["image.png: Could not read image."]);
});

test("the same eight-image limit reserves slots for unfinished files and clipboard reads", () => {
  for (const owner of [a, "new-chat"]) {
    const f = fixture();
    f.start(owner);
    f.finish(0);
    const files = Array.from(
      { length: 8 },
      (_, index) => new File(["x"], `${index}.png`, { type: "image/png" }),
    );
    f.reads.startFiles(owner, files, async (name) => name);
    f.reads.startClipboard(owner, async () => "unreachable");
    expect(f.readers).toHaveLength(8);
    expect(f.reads.pending(owner)).toBe(7);
    expect(f.notices).toEqual([imageLimitMessage, imageLimitMessage]);
    for (let i = 1; i < 8; i++) f.finish(i);
    expect(f.drafts.read(owner).content.images).toHaveLength(8);
    if (typeof owner === "string")
      expect(f.drafts.protectedAddresses()).toEqual([]);
  }
});

test("restoring a queued send returns loaded and still-pending attachments to its draft", async () => {
  const f = fixture();
  f.start("opening");
  f.start("opening");
  const claim = f.reads.claim("opening");
  if (!claim) throw Error("Expected two pending reads");
  f.finish(0);
  const loaded = claim.restore("opening");
  f.drafts.edit("opening", (content) => ({ ...content, ...loaded }));
  expect(await claim.result).toBe(loaded);
  expect(f.reads.pending("opening")).toBe(1);
  f.reads.transfer("opening", b);
  f.finish(1);
  expect(f.drafts.read("opening").content.images[0].image.data).toBe("image-0");
  expect(f.drafts.read(b).content.images[0].image.data).toBe("image-1");
});
