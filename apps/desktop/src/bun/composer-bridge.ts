import { withDraftFiles } from "../shared/attachments";
import type { ExtensionUIEvent } from "../shared/extension-ui";
import { makeMarker, shouldCollapse, unfoldPastes } from "../shared/paste";
import type {
  DraftContent,
  DraftState,
  DraftSyncParams,
  DraftSyncResult,
  RecoveredDraft,
  SessionAddress,
} from "../shared/runtime-contract";
import { checkText, sessionKey } from "./ui-request-broker";

const CONTENT_LIMIT = 64 * 1024 * 1024;
/** Synchronous Bun mirror. Never shares mutable draft objects with RPC callers. */
export class ComposerBridge {
  private readonly drafts = new Map<string, DraftState>();
  private readonly retired = new Set<string>();
  private readonly transfers = new Map<
    string,
    { next: SessionAddress; revision: number; nextRevision: number }
  >();
  private pasteId = 0;
  private imageSizes = new WeakMap<DraftContent["images"], number>();
  constructor(
    private readonly emit: (event: ExtensionUIEvent) => void,
    private readonly save?: (
      address: SessionAddress,
      draft: DraftState,
      previous?: SessionAddress,
      keepImages?: boolean,
    ) => void,
  ) {}
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
    if (params.keepImages && (params.requestId || params.content.images.length))
      throw new Error("Invalid image reuse request");
    const content = params.keepImages
      ? { ...params.content, images: current.images }
      : params.content;
    this.validate(content);
    const next = {
      ...structuredClone(content),
      revision: this.revision(current),
    };
    this.imageSizes.set(
      next.images,
      this.imageSizes.get(content.images) as number,
    );
    this.commit(params, next, true, !!params.keepImages);
    return {
      applied: true,
      draft: structuredClone(
        params.keepImages ? { ...next, images: [] } : next,
      ),
    };
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
    this.commit(address, next, true, true);
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
    return withDraftFiles(
      unfoldPastes(draft.text, draft.pastes),
      draft.files,
      draft.annotations,
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
    const revision = draft.revision;
    draft.revision = this.revision(draft);
    this.save?.(next, draft, previous);
    this.drafts.delete(from);
    this.retired.add(from);
    this.transfers.set(from, { next, revision, nextRevision: draft.revision });
    this.commit(next, draft, false);
  }
  consume(
    address: SessionAddress,
    revision: number,
    save: (consumed?: Pick<RecoveredDraft, "address" | "draft">) => void,
  ): void {
    const transfer = this.transfers.get(sessionKey(address));
    if (transfer && transfer.revision === revision) {
      this.consume(transfer.next, transfer.nextRevision, save);
      return;
    }
    const current = this.drafts.get(sessionKey(address));
    if (
      this.retired.has(sessionKey(address)) ||
      current?.revision !== revision
    ) {
      save();
      return;
    }
    const draft = {
      text: "",
      pastes: [],
      images: [],
      revision: this.revision(current),
      consumedRevision: revision,
    };
    // SDK acceptance cannot be rolled back when a disk write fails.
    try {
      save({ address, draft });
    } finally {
      this.commit(address, draft, false);
    }
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
  private commit(
    address: SessionAddress,
    draft: DraftState,
    persist = true,
    keepImages = false,
  ): void {
    if (persist)
      this.save?.(
        address,
        draft,
        undefined,
        keepImages && draft.images.length > 0,
      );
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
    const imageBytes = this.imageSizes.get(content.images);
    validateDraftContent(content, imageBytes);
    if (imageBytes === undefined)
      this.imageSizes.set(
        content.images,
        Buffer.byteLength(JSON.stringify(content.images)) - 2,
      );
  }
}
export function validateDraftContent(
  content: DraftContent,
  imageBytes?: number,
): void {
  if (
    !content ||
    !Array.isArray(content.pastes) ||
    !Array.isArray(content.images) ||
    content.pastes.length > 10_000 ||
    content.images.length > 256 ||
    (content.files !== undefined &&
      (!Array.isArray(content.files) || content.files.length > 256)) ||
    (content.annotations !== undefined &&
      (!Array.isArray(content.annotations) || content.annotations.length > 256))
  )
    throw new TypeError("Invalid draft content");
  for (const file of content.files ?? []) {
    checkText(file.id, 256);
    checkText(file.path, 4096);
    checkText(file.name, 1024);
    if (!file.id || !file.path) throw new TypeError("Invalid draft file");
  }
  for (const annotation of content.annotations ?? []) {
    checkText(annotation.id, 256);
    checkText(annotation.quote, CONTENT_LIMIT);
    checkText(annotation.comment, CONTENT_LIMIT);
    if (!annotation.id || !annotation.quote)
      throw new TypeError("Invalid draft annotation");
  }
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
  const size =
    imageBytes === undefined
      ? Buffer.byteLength(JSON.stringify(content))
      : Buffer.byteLength(
          JSON.stringify({
            text: content.text,
            pastes: content.pastes,
            images: [],
            files: content.files,
            annotations: content.annotations,
          }),
        ) + imageBytes;
  if (size > CONTENT_LIMIT) throw new RangeError("Draft size exceeded");
}
