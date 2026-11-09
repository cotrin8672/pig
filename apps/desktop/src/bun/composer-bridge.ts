import type { ExtensionUIEvent } from "../shared/extension-ui";
import { makeMarker, shouldCollapse } from "../shared/paste";
import type {
  DraftContent,
  DraftState,
  DraftSyncParams,
  DraftSyncResult,
  SessionAddress,
} from "../shared/runtime-contract";
import { checkText, sessionKey } from "./ui-request-broker";

const CONTENT_LIMIT = 64 * 1024 * 1024;
/** Synchronous Bun mirror. Never shares mutable draft objects with RPC callers. */
export class ComposerBridge {
  private readonly drafts = new Map<string, DraftState>();
  private readonly retired = new Set<string>();
  private pasteId = 0;
  constructor(private readonly emit: (event: ExtensionUIEvent) => void) {}
  read(address: SessionAddress): DraftState {
    return structuredClone(this.current(address));
  }
  sync(params: DraftSyncParams): DraftSyncResult {
    const current = this.current(params);
    if (
      !Number.isSafeInteger(params.expectedRevision) ||
      params.expectedRevision < 0
    )
      throw new TypeError("Invalid draft revision");
    if (current.revision !== params.expectedRevision)
      return { applied: false, draft: structuredClone(current) };
    this.validate(params.content);
    const next = {
      ...structuredClone(params.content),
      revision: this.revision(current),
    };
    this.commit(params, next);
    return { applied: true, draft: structuredClone(next) };
  }
  setText(address: SessionAddress, text: string): void {
    checkText(text, CONTENT_LIMIT);
    const current = this.current(address);
    const next = {
      ...current,
      text,
      pastes: current.pastes.filter((paste) => text.includes(paste.marker)),
      revision: this.revision(current),
    };
    this.validate(next);
    this.commit(address, next);
  }
  paste(address: SessionAddress, text: string): void {
    checkText(text, CONTENT_LIMIT);
    text = text.replace(/\r\n/g, "\n");
    const current = this.current(address);
    const next = structuredClone(current);
    if (shouldCollapse(text)) {
      // Use the same folding format/threshold as the React Composer. Avoid marker
      // collisions with both existing records and unexpanded literal draft text.
      let marker: string;
      do {
        marker = makeMarker(++this.pasteId, text);
      } while (
        next.pastes.some((paste) => paste.id === String(this.pasteId)) ||
        next.text.includes(marker)
      );
      next.pastes.push({ id: String(this.pasteId), marker, text });
      next.text += marker;
    } else next.text += text;
    next.revision = this.revision(current);
    this.validate(next);
    this.commit(address, next);
  }
  /** Expanded editor text, single pass (paste payloads are never recursively expanded). */
  expandedText(address: SessionAddress): string {
    const draft = this.current(address);
    const pastes = new Map(
      draft.pastes.map((paste) => [paste.marker, paste.text]),
    );
    return draft.text.replace(
      /\[paste #\d+ (?:\+\d+ lines|\d+ chars)\]/g,
      (marker) => pastes.get(marker) ?? marker,
    );
  }
  transfer(previous: SessionAddress, next: SessionAddress): void {
    const from = sessionKey(previous);
    const to = sessionKey(next);
    if (from === to) return;
    if (previous.hostId !== next.hostId || next.epoch <= previous.epoch)
      throw new Error("Invalid draft epoch transfer");
    if (this.drafts.has(to) || this.retired.has(to))
      throw new Error("Draft transfer target already exists");
    const draft = structuredClone(this.current(previous));
    draft.revision = this.revision(draft);
    this.drafts.delete(from);
    this.retired.add(from);
    this.commit(next, draft);
  }
  remove(address: SessionAddress): void {
    const id = sessionKey(address);
    this.drafts.delete(id);
    this.retired.add(id);
  }
  private current(address: SessionAddress): DraftState {
    const id = sessionKey(address);
    if (this.retired.has(id)) throw new Error("Stale draft address");
    let draft = this.drafts.get(id);
    if (!draft) {
      draft = { text: "", pastes: [], images: [], revision: 0 };
      this.drafts.set(id, draft);
    }
    return draft;
  }
  private revision(draft: DraftState): number {
    if (draft.revision >= Number.MAX_SAFE_INTEGER)
      throw new RangeError("Draft revision exhausted");
    return draft.revision + 1;
  }
  private commit(address: SessionAddress, draft: DraftState): void {
    this.drafts.set(sessionKey(address), draft);
    this.emit({
      type: "draft",
      address: {
        hostId: address.hostId,
        sessionId: address.sessionId,
        epoch: address.epoch,
      },
      draft: structuredClone(draft),
    });
  }
  private validate(content: DraftContent): void {
    if (
      !content ||
      !Array.isArray(content.pastes) ||
      !Array.isArray(content.images) ||
      content.pastes.length > 10_000 ||
      content.images.length > 256
    )
      throw new TypeError("Invalid draft content");
    checkText(content.text, CONTENT_LIMIT);
    const ids = new Set<string>();
    const markers = new Set<string>();
    for (const paste of content.pastes) {
      checkText(paste.id, 256);
      checkText(paste.marker, 256);
      checkText(paste.text, CONTENT_LIMIT);
      if (
        !paste.id ||
        ids.has(paste.id) ||
        markers.has(paste.marker) ||
        !/^\[paste #\d+ (?:\+\d+ lines|\d+ chars)\]$/.test(paste.marker)
      )
        throw new TypeError("Invalid paste record");
      ids.add(paste.id);
      markers.add(paste.marker);
    }
    ids.clear();
    for (const item of content.images) {
      checkText(item.id, 256);
      if (!item.id || ids.has(item.id) || item.image?.type !== "image")
        throw new TypeError("Invalid draft image");
      checkText(item.image.data, CONTENT_LIMIT);
      checkText(item.image.mimeType, 256);
      ids.add(item.id);
    }
    if (Buffer.byteLength(JSON.stringify(content)) > CONTENT_LIMIT)
      throw new RangeError("Draft size exceeded");
  }
}
