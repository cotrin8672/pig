import type { DraftFile } from "../shared/attachments";
import type { DraftContent, SessionAddress } from "../shared/runtime-contract";
import { sameAddress } from "./chat-snapshot";
import type { DraftAddress, DraftStore } from "./draft-store";

const maxImageBase64 = 4.5 * 1024 * 1024;
export const imageLimitMessage = "You can attach up to 8 images.";
export const imageSizeMessage =
  "Each image must be at most 4.5 MiB of base64 data.";
const imageTypes = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);
type Loaded = Pick<DraftContent, "images" | "files">;
type Claim = {
  reads: Read[];
  loaded: Map<
    string,
    { image?: DraftContent["images"][number]; file?: DraftFile }
  >;
  resolve(value: Loaded): void;
  reject(error: Error): void;
  error?: Error;
};
export type AttachmentClaim = {
  result: Promise<Loaded>;
  restore(address: DraftAddress): Loaded;
};
type Read = {
  id: string;
  address: DraftAddress;
  name: string;
  kind: "image" | "file";
  state: "pending" | "ready";
  preview: boolean;
  reader: FileReader;
  claim?: Claim;
};
const ownsRead = (read: Read, address: DraftAddress) =>
  typeof read.address === "string" || typeof address === "string"
    ? read.address === address
    : sameAddress(read.address, address);

function loadedAttachments(claim: Claim): Loaded {
  const ordered = claim.reads.map((read) => claim.loaded.get(read.id));
  return {
    images: ordered.flatMap((each) => (each?.image ? [each.image] : [])),
    files: ordered.flatMap((each) => (each?.file ? [each.file] : [])),
  };
}

/** Reads follow explicit draft transfers, never the currently visible chat. */
export class AttachmentReads {
  private reads = new Map<string, Read>();
  private listeners = new Set<() => void>();
  private tick = 0;
  getTick = () => this.tick;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  constructor(
    private drafts: DraftStore,
    private notice: (message: string) => void,
    private createReader = () => new FileReader(),
  ) {
    drafts.subscribe(() => {
      for (const read of this.reads.values()) {
        if (read.claim) continue;
        const draft = drafts.read(read.address);
        if (draft.retired && !draft.transferred) {
          this.cancel(read.id);
          this.notice(
            `Image loading cancelled because its chat closed: ${read.name}`,
          );
        }
      }
    });
  }
  private changed() {
    this.tick++;
    for (const listener of this.listeners) listener();
  }
  /** Unsent attachments still owned by the editor. */
  read(address: DraftAddress) {
    return [...this.reads.values()].filter(
      (read) =>
        !read.claim && read.state === "pending" && ownsRead(read, address),
    );
  }
  pending(address: DraftAddress) {
    return this.read(address).length;
  }
  protectedAddresses(): SessionAddress[] {
    return [...this.reads.values()].flatMap((read) =>
      read.state === "pending" && typeof read.address !== "string"
        ? [read.address]
        : [],
    );
  }
  /**
   * Moves every in-flight attachment from the editor to the message being
   * sent, so a late load can never land in the next draft.
   */
  claim(address: DraftAddress): AttachmentClaim | undefined {
    const reads = this.read(address);
    if (!reads.length) return;
    const result = Promise.withResolvers<Loaded>();
    // Startup or an earlier send may hold the queue after the read already failed.
    void result.promise.catch(() => {});
    const claim: Claim = { reads, loaded: new Map(), ...result };
    for (const read of reads) read.claim = claim;
    this.changed();
    return {
      result: result.promise,
      restore: (owner) => {
        for (const read of reads) {
          if (read.claim !== claim || !this.reads.has(read.id)) continue;
          read.claim = undefined;
          read.address = owner;
        }
        const loaded = loadedAttachments(claim);
        claim.resolve(loaded);
        if (claim.error) this.notice(claim.error.message);
        this.changed();
        return loaded;
      },
    };
  }
  transfer(previous: DraftAddress, next: SessionAddress) {
    let moved = false;
    for (const read of this.reads.values()) {
      if (!ownsRead(read, previous)) continue;
      read.address = next;
      moved = true;
    }
    if (moved) this.changed();
  }
  cancel(id: string) {
    const read = this.reads.get(id);
    if (!read) return;
    this.reads.delete(id);
    read.reader.onload = read.reader.onerror = read.reader.onabort = null;
    read.reader.abort();
    read.claim?.reject(new Error(`Attachment removed: ${read.name}`));
    this.releaseReady(read.address);
    this.changed();
  }
  private releaseReady(address: DraftAddress) {
    const reads = [...this.reads.values()].filter((read) =>
      ownsRead(read, address),
    );
    if (!reads.some((read) => read.state === "pending"))
      for (const read of reads)
        if (read.state === "ready") this.reads.delete(read.id);
  }
  private deliver(read: Read, item: Loaded) {
    read.state = "ready";
    read.reader.onload = read.reader.onerror = read.reader.onabort = null;
    const claim = read.claim;
    if (claim) {
      this.reads.delete(read.id);
      claim.loaded.set(read.id, {
        image: item.images[0],
        file: item.files?.[0],
      });
      if (claim.reads.every((each) => claim.loaded.has(each.id)))
        claim.resolve(loadedAttachments(claim));
    } else {
      const order = [...this.reads.values()]
        .filter((each) => ownsRead(each, read.address))
        .map((each) => each.id);
      this.drafts.edit(read.address, (content) => ({
        ...content,
        images: [...content.images, ...item.images].sort(
          (a, b) => order.indexOf(a.id) - order.indexOf(b.id),
        ),
        ...(item.files?.length
          ? { files: [...(content.files ?? []), ...item.files] }
          : {}),
      }));
    }
    this.releaseReady(read.address);
    this.changed();
  }
  private begin(address: DraftAddress, file: File, kind: Read["kind"]) {
    if (this.drafts.read(address).retired) {
      this.notice(
        `Image loading cancelled because its chat closed: ${file.name}`,
      );
      return;
    }
    const reader = this.createReader();
    const read: Read = {
      id: crypto.randomUUID(),
      address,
      name: file.name,
      kind,
      reader,
      state: "pending",
      preview: true,
    };
    this.reads.set(read.id, read);
    const fail = (error: unknown) => {
      if (!this.reads.has(read.id) || read.state !== "pending") return;
      this.reads.delete(read.id);
      const message = `${read.name}: ${error instanceof Error ? error.message : String(error)}`;
      reader.onload = reader.onerror = reader.onabort = null;
      reader.abort();
      if (read.claim) {
        // The message fails as a whole and returns to the editor with this error.
        read.claim.error = new Error(message);
        read.claim.reject(read.claim.error);
      } else this.notice(message);
      this.releaseReady(read.address);
      this.changed();
    };
    return { read, reader, fail };
  }
  private imageSlot(address: DraftAddress) {
    if (
      this.drafts.read(address).content.images.length +
        this.read(address).filter((load) => load.kind === "image").length <
      8
    )
      return true;
    this.notice(imageLimitMessage);
    return false;
  }
  startFiles(
    address: DraftAddress,
    files: File[],
    store: (name: string, data: string) => Promise<string>,
  ) {
    for (const file of files) {
      if (imageTypes.has(file.type)) this.start(address, file);
      else this.startFile(address, file, store);
    }
  }
  start(address: DraftAddress, file: File) {
    if (!this.imageSlot(address)) return;
    if (4 * Math.ceil(file.size / 3) > maxImageBase64) {
      this.notice(imageSizeMessage);
      return;
    }
    const started = this.begin(address, file, "image");
    if (!started) return;
    const { read, reader, fail } = started;
    reader.onload = () => {
      if (!this.reads.has(read.id) || read.state !== "pending") return;
      try {
        const data = String(reader.result).replace(/^data:[^,]*;base64,/, "");
        if (data.length > maxImageBase64) throw new Error(imageSizeMessage);
        reader.abort();
        this.deliver(read, {
          images: [
            {
              id: read.id,
              image: { type: "image" as const, data, mimeType: file.type },
            },
          ],
        });
      } catch (error) {
        fail(error);
      }
    };
    reader.onerror = reader.onabort = () =>
      fail(new Error("Could not read image."));
    this.changed();
    try {
      reader.readAsDataURL(file);
    } catch (error) {
      fail(error);
    }
  }
  startClipboard(address: DraftAddress, load: () => Promise<string | null>) {
    if (!this.imageSlot(address)) return;
    const started = this.begin(address, new File([], "clipboard.png"), "image");
    if (!started) return;
    const { read, fail } = started;
    // A native probe may contain no image. Track it for sends/transfers, but
    // don't flash an attachment placeholder before we know there is one.
    read.preview = false;
    this.changed();
    void Promise.resolve()
      .then(load)
      .then((data) => {
        if (!this.reads.has(read.id) || read.state !== "pending") return;
        if (!data) {
          fail(new Error("No image could be read from the clipboard."));
          return;
        }
        if (data.length > maxImageBase64) {
          fail(new Error(imageSizeMessage));
          return;
        }
        this.deliver(read, {
          images: [
            {
              id: read.id,
              image: { type: "image", mimeType: "image/png", data },
            },
          ],
        });
      }, fail);
  }
  /** Non-image files go to the agent as a stored path, like pi's TUI paste. */
  startFile(
    address: DraftAddress,
    file: File,
    store: (name: string, data: string) => Promise<string>,
  ) {
    const started = this.begin(address, file, "file");
    if (!started) return;
    const { read, reader, fail } = started;
    reader.onload = () => {
      if (!this.reads.has(read.id) || read.state !== "pending") return;
      const url = String(reader.result);
      reader.onload = reader.onerror = reader.onabort = null;
      void Promise.resolve()
        .then(() => store(file.name, url.slice(url.indexOf(",") + 1)))
        .then((path) => {
          if (!this.reads.has(read.id) || read.state !== "pending") return;
          this.deliver(read, {
            images: [],
            files: [{ id: read.id, path, name: file.name }],
          });
        }, fail);
    };
    reader.onerror = reader.onabort = () =>
      fail(new Error(`Could not read ${file.name}`));
    this.changed();
    try {
      reader.readAsDataURL(file);
    } catch (error) {
      fail(error);
    }
  }
}
