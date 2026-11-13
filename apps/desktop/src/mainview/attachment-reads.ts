import type { DraftFile } from "../shared/attachments";
import type { DraftContent, SessionAddress } from "../shared/runtime-contract";
import { addressKey, sameAddress } from "./chat-snapshot";
import type { DraftStore } from "./draft-store";

export const maxImageBase64 = 4.5 * 1024 * 1024;
type Loaded = Pick<DraftContent, "images" | "files">;
type Claim = {
  reads: Read[];
  loaded: Map<
    string,
    { image?: DraftContent["images"][number]; file?: DraftFile }
  >;
  resolve(value: Loaded): void;
  reject(error: Error): void;
};
type Read = {
  id: string;
  address: SessionAddress;
  name: string;
  kind: "image" | "file";
  state: "pending" | "ready";
  preview: boolean;
  reader: FileReader;
  claim?: Claim;
};

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
  read(address: SessionAddress) {
    return [...this.reads.values()].filter(
      (read) =>
        !read.claim &&
        read.state !== "ready" &&
        sameAddress(read.address, address),
    );
  }
  pending(address: SessionAddress) {
    return this.read(address).filter((read) => read.state === "pending").length;
  }
  /**
   * Moves every in-flight attachment from the editor to the message being
   * sent, so a late load can never land in the next draft.
   */
  claim(address: SessionAddress): Promise<Loaded> | undefined {
    const reads = this.read(address).filter((read) => read.state === "pending");
    if (!reads.length) return;
    const result = Promise.withResolvers<Loaded>();
    const claim: Claim = { reads, loaded: new Map(), ...result };
    for (const read of reads) read.claim = claim;
    this.changed();
    return result.promise;
  }
  transfer(previous: SessionAddress, next: SessionAddress) {
    for (const read of this.reads.values())
      if (addressKey(read.address) === addressKey(previous))
        read.address = next;
    this.changed();
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
  private releaseReady(address: SessionAddress) {
    const reads = [...this.reads.values()].filter((read) =>
      sameAddress(read.address, address),
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
      if (claim.reads.every((each) => claim.loaded.has(each.id))) {
        const ordered = claim.reads.map((each) => claim.loaded.get(each.id));
        claim.resolve({
          images: ordered.flatMap((each) => (each?.image ? [each.image] : [])),
          files: ordered.flatMap((each) => (each?.file ? [each.file] : [])),
        });
      }
    } else {
      const order = [...this.reads.values()]
        .filter((each) => sameAddress(each.address, read.address))
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
  private begin(address: SessionAddress, file: File, kind: Read["kind"]) {
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
        read.claim.reject(new Error(message));
      } else this.notice(message);
      this.releaseReady(read.address);
      this.changed();
    };
    return { read, reader, fail };
  }
  start(address: SessionAddress, file: File) {
    const started = this.begin(address, file, "image");
    if (!started) return;
    const { read, reader, fail } = started;
    reader.onload = () => {
      if (!this.reads.has(read.id) || read.state !== "pending") return;
      try {
        const data = String(reader.result).replace(/^data:[^,]*;base64,/, "");
        if (data.length > maxImageBase64)
          throw new Error("Each image must be at most 4.5 MiB of base64 data.");
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
  startClipboard(address: SessionAddress, load: () => Promise<string | null>) {
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
          fail(new Error("Each image must be at most 4.5 MiB of base64 data."));
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
    address: SessionAddress,
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
      void store(file.name, url.slice(url.indexOf(",") + 1)).then((path) => {
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
