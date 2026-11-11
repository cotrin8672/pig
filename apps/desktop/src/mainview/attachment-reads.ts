import type { SessionAddress } from "../shared/runtime-contract";
import { addressKey, sameAddress } from "./chat-snapshot";
import type { DraftStore } from "./draft-store";

export const maxImageBase64 = 4.5 * 1024 * 1024;
type Read = {
  id: string;
  address: SessionAddress;
  name: string;
  state: "pending" | "error" | "ready";
  error?: string;
  reader: FileReader;
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
  read(address: SessionAddress) {
    return [...this.reads.values()].filter(
      (read) => read.state !== "ready" && sameAddress(read.address, address),
    );
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
  start(address: SessionAddress, file: File) {
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
      reader,
      state: "pending",
    };
    this.reads.set(read.id, read);
    const fail = (error: unknown) => {
      if (!this.reads.has(read.id) || read.state !== "pending") return;
      read.state = "error";
      read.error = error instanceof Error ? error.message : String(error);
      reader.onload = reader.onerror = reader.onabort = null;
      reader.abort();
      this.releaseReady(read.address);
      this.changed();
    };
    reader.onload = () => {
      if (!this.reads.has(read.id) || read.state !== "pending") return;
      try {
        const data = String(reader.result).replace(/^data:[^,]*;base64,/, "");
        if (data.length > maxImageBase64)
          throw new Error("Each image must be at most 4.5 MiB of base64 data.");
        const order = [...this.reads.values()]
          .filter((item) => sameAddress(item.address, read.address))
          .map((item) => item.id);
        this.drafts.edit(read.address, (content) => ({
          ...content,
          images: [
            ...content.images,
            {
              id: read.id,
              image: { type: "image" as const, data, mimeType: file.type },
            },
          ].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id)),
        }));
        read.state = "ready";
        reader.onload = reader.onerror = reader.onabort = null;
        reader.abort();
        this.releaseReady(read.address);
        this.changed();
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
}
