import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { splitAttachmentPaths } from "../shared/attachments";
import {
  attachmentPreview,
  storeFile,
  storeImage,
  withAttachmentPaths,
} from "./attachments";
import { ComposerBridge, validateDraftContent } from "./composer-bridge";

test("attachments are content-addressed paths appended after a blank line", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pig-attachments-"));
  try {
    const data = Buffer.from("hello").toString("base64");
    const a = await storeFile("notes.TXT", data, dir);
    expect(await storeFile("other.txt", data, dir)).toBe(a);
    expect(a).toEndWith(".txt");
    expect(await readFile(a, "utf8")).toBe("hello");
    expect(await storeFile("weird.<x>", data, dir)).not.toContain("<");
    const image = await storeImage(
      { type: "image", mimeType: "image/jpeg", data },
      dir,
    );
    expect(image).toEndWith(".jpg");
    expect(await attachmentPreview(image, dir)).toBe(
      `data:image/jpeg;base64,${data}`,
    );
    expect(await attachmentPreview(a, dir)).toBeNull();
    expect(await attachmentPreview(image, join(dir, "other"))).toBeNull();
    expect(await attachmentPreview(join(dir, "private.png"), dir)).toBeNull();
    expect(withAttachmentPaths("look", [a, image])).toBe(
      `look\n\n${a}\n${image}`,
    );
    expect(withAttachmentPaths("", [a])).toBe(a);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("only trailing managed attachment paths become UI cards, without changing the sent text", () => {
  const hash = "a".repeat(64);
  for (const path of [
    `C:\\Users\\me\\attachments\\${hash}.png`,
    `/home/me/attachments/${hash}.pdf`,
  ]) {
    expect(splitAttachmentPaths(`hello\n\n${path}`)).toEqual({
      body: "hello",
      paths: [path],
    });
    expect(splitAttachmentPaths(path)).toEqual({ body: "", paths: [path] });
    const prose = `${path}\nkeep this`;
    expect(splitAttachmentPaths(prose)).toEqual({ body: prose, paths: [] });
  }
  expect(splitAttachmentPaths("hello\n\n/private/file.txt").paths).toEqual([]);
});

test("draft files are sent as trailing paths and validated", () => {
  const address = { hostId: "h", sessionId: "s", epoch: 1 };
  const bridge = new ComposerBridge(() => {});
  const files = [{ id: "1", path: "/a/b.pdf", name: "b.pdf" }];
  bridge.sync({
    ...address,
    expectedRevision: 0,
    content: { text: "read this", pastes: [], images: [], files },
  });
  expect(bridge.expandedText(address)).toBe("read this\n\n/a/b.pdf");
  expect(() =>
    validateDraftContent({
      text: "",
      pastes: [],
      images: [],
      files: [{ id: "", path: "", name: "" }],
    }),
  ).toThrow("Invalid draft file");
});
