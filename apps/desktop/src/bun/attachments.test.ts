import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { storeFile, storeImage, withAttachmentPaths } from "./attachments";

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
    expect(withAttachmentPaths("look", [a, image])).toBe(
      `look\n\n${a}\n${image}`,
    );
    expect(withAttachmentPaths("", [a])).toBe(a);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
