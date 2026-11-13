import { withDraftFiles } from "../shared/attachments";
import { unfoldPastes } from "../shared/paste";
import type {
  DraftContent,
  DraftImagesRef,
  DraftOwner,
  DraftState,
  DraftSyncParams,
  DraftSyncResult,
  PromptDelivery,
  SessionAddress,
} from "../shared/runtime-contract";
import { addressKey } from "./chat-snapshot";
import { sameImages } from "./draft-mirror";

export const emptyContent = (): DraftContent => ({
  text: "",
  pastes: [],
  images: [],
});
export type EditorDraft = {
  content: DraftContent;
  revision: number;
  version: number;
  dirty: boolean;
  conflict?: DraftState;
  retired?: boolean;
  transferred?: boolean;
  /** Late receipts track the destination version without retaining its payload. */
  transferredVersion?: number;
  clearedForSend?: boolean;
  owner?: DraftOwner;
};
type Flight = {
  content: DraftContent;
  expectedRevision: number;
  version: number;
};
const contentOf = ({
  text,
  pastes,
  images,
  files,
  annotations,
}: DraftContent): DraftContent => ({
  text,
  pastes,
  images,
  ...(files?.length ? { files } : {}),
  ...(annotations?.length ? { annotations } : {}),
});
const ids = (items: { id: string }[] = []) =>
  items.map((item) => item.id).join("\0");
const equal = (a: DraftContent, b: DraftContent) =>
  a.text === b.text &&
  (a.pastes === b.pastes ||
    (a.pastes.length === b.pastes.length &&
      a.pastes.every(
        (p, i) =>
          p.id === b.pastes[i].id &&
          p.marker === b.pastes[i].marker &&
          p.text === b.pastes[i].text,
      ))) &&
  sameImages(a.images, b.images) &&
  ids(a.files) === ids(b.files) &&
  ids(a.annotations) === ids(b.annotations);
/** Address-owned drafts outlive React mounts, tab navigation and asynchronous file reads. */
export class DraftStore {
  private entries = new Map<string, EditorDraft>();
  private owners = new Map<string, SessionAddress>();
  private remoteImages = new Map<
    string,
    { revision: number; images: DraftContent["images"] }
  >();
  private tick = 0;
  getTick = () => this.tick;
  retained() {
    return [...this.owners].flatMap(([key, address]) => {
      const draft = this.entries.get(key);
      return draft?.retired &&
        !draft.transferred &&
        (draft.content.text ||
          draft.content.images.length ||
          draft.content.files?.length ||
          draft.content.annotations?.length)
        ? [{ address, draft }]
        : [];
    });
  }
  private listeners = new Set<() => void>();
  private queues = new Map<string, Promise<unknown>>();
  private flights = new Map<string, Flight>();
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  read(address: SessionAddress): EditorDraft {
    const key = addressKey(address);
    this.owners.set(key, address);
    let draft = this.entries.get(key);
    if (!draft) {
      draft = {
        content: emptyContent(),
        revision: 0,
        version: 0,
        dirty: false,
      };
      this.entries.set(key, draft);
    }
    return draft;
  }
  private put(address: SessionAddress, draft: EditorDraft) {
    this.entries.set(addressKey(address), draft);
    this.tick++;
    for (const listener of this.listeners) listener();
  }
  edit(
    address: SessionAddress,
    change: (content: DraftContent) => DraftContent,
    allowRetired = false,
  ) {
    const draft = this.read(address);
    if (draft.retired && !allowRetired) return;
    this.put(address, {
      ...draft,
      content: change(draft.content),
      clearedForSend: false,
      version: draft.version + 1,
      dirty: true,
    });
  }
  receive(
    address: SessionAddress,
    remote: DraftState,
    imageRefs?: DraftImagesRef,
  ): boolean {
    const draft = this.read(address);
    if (draft.retired || remote.revision < draft.revision) return true;
    const key = addressKey(address);
    if (imageRefs) {
      const cached = this.remoteImages.get(key);
      if (
        remote.images.length ||
        !cached ||
        (cached.revision !== imageRefs.revision &&
          cached.revision !== remote.revision) ||
        cached.images.length !== imageRefs.ids.length ||
        cached.images.some((image, index) => image.id !== imageRefs.ids[index])
      )
        return false;
      remote = { ...remote, images: cached.images };
    }
    this.remoteImages.set(key, {
      revision: remote.revision,
      images: remote.images,
    });
    const flight = this.flights.get(addressKey(address));
    const own =
      flight &&
      remote.revision === flight.expectedRevision + 1 &&
      equal(remote, flight.content);
    if (draft.dirty && remote.consumedRevision === draft.revision) {
      this.put(address, {
        ...draft,
        revision: remote.revision,
        conflict: undefined,
      });
    } else if (own || equal(draft.content, remote)) {
      this.put(address, {
        ...draft,
        revision: remote.revision,
        dirty: !equal(draft.content, remote),
        conflict: undefined,
      });
    } else if (remote.revision === draft.revision) {
      // Initial/repeated state cannot overwrite unsynced edits.
      if (!draft.dirty)
        this.put(address, {
          ...draft,
          content: contentOf(remote),
          version: draft.version + 1,
        });
    } else if (draft.dirty) {
      this.put(address, {
        ...draft,
        revision: remote.revision,
        conflict: remote,
      });
    } else {
      this.put(address, {
        content: contentOf(remote),
        revision: remote.revision,
        version: draft.version + 1,
        dirty: false,
      });
    }
    return true;
  }
  resolve(address: SessionAddress, choice: "local" | "extension") {
    const draft = this.read(address);
    if (!draft.conflict || draft.retired) return;
    this.put(address, {
      ...draft,
      content: choice === "local" ? draft.content : contentOf(draft.conflict),
      conflict: undefined,
      dirty: choice === "local",
      version: draft.version + 1,
    });
  }
  transfer(previous: SessionAddress, next: SessionAddress) {
    if (addressKey(previous) === addressKey(next)) return;
    const old = this.read(previous);
    if (old.transferred) return;
    this.remoteImages.delete(addressKey(previous));
    const current = this.read(next);
    // A new epoch's startup editor event may beat the replaced publication.
    // Never overwrite that newer extension text with a clean old mirror.
    const keepCurrent =
      (!old.dirty || old.clearedForSend) && current.revision > 0;
    const version = Math.max(old.version, current.version) + 1;
    this.put(previous, {
      ...old,
      content: emptyContent(),
      conflict: undefined,
      dirty: false,
      retired: true,
      transferred: true,
      transferredVersion: keepCurrent ? undefined : version,
    });
    if (keepCurrent) return;
    this.put(next, {
      ...current,
      content: old.content,
      dirty: old.dirty,
      conflict:
        old.dirty &&
        current.revision > 0 &&
        !equal(old.content, current.content)
          ? { ...current.content, revision: current.revision }
          : old.conflict,
      version,
    });
  }
  retire(address: SessionAddress) {
    this.remoteImages.delete(addressKey(address));
    const draft = this.read(address);
    this.put(address, { ...draft, retired: true });
  }
  recover(address: SessionAddress, remote: DraftState, owner?: DraftOwner) {
    if (this.entries.has(addressKey(address))) return;
    this.receive(address, remote);
    this.put(address, { ...this.read(address), retired: true, owner });
  }
  discard(address: SessionAddress, deleted = false) {
    const draft = this.read(address);
    if (!draft.retired && !deleted) return;
    this.remoteImages.delete(addressKey(address));
    this.put(address, {
      ...draft,
      content: emptyContent(),
      dirty: false,
      ...(deleted ? { retired: true } : {}),
    });
  }
  restoreSent(address: SessionAddress, sent: DraftContent) {
    const draft = this.read(address);
    // The replacement owner receives forwarded results; never strand a copy here.
    if (draft.transferred) return;
    const current = draft.content;
    const text = [
      unfoldPastes(sent.text, sent.pastes),
      unfoldPastes(current.text, current.pastes),
    ]
      .filter(Boolean)
      .join("\n\n");
    this.put(address, {
      ...draft,
      content: {
        text,
        pastes: [],
        images: [
          ...new Map(
            [...sent.images, ...current.images].map((image) => [
              image.id,
              image,
            ]),
          ).values(),
        ],
        files: [
          ...new Map(
            [...(sent.files ?? []), ...(current.files ?? [])].map((file) => [
              file.id,
              file,
            ]),
          ).values(),
        ],
        annotations: [
          ...new Map(
            [...(sent.annotations ?? []), ...(current.annotations ?? [])].map(
              (annotation) => [annotation.id, annotation],
            ),
          ).values(),
        ],
      },
      version: draft.version + 1,
      dirty: true,
      clearedForSend: false,
    });
  }
  clearForSend(address: SessionAddress, sentVersion: number) {
    if (!this.clearAccepted(address, sentVersion)) return;
    this.put(address, { ...this.read(address), clearedForSend: true });
  }
  clearAccepted(address: SessionAddress, sentVersion: number) {
    const draft = this.read(address);
    if (draft.retired || draft.version !== sentVersion || draft.conflict)
      return false;
    this.edit(address, emptyContent);
    return true;
  }
  flushAll(sync: (params: DraftSyncParams) => Promise<DraftSyncResult>) {
    return Promise.all(
      [...this.owners.values()].flatMap((address) => {
        const draft = this.read(address);
        return draft.dirty && !draft.retired
          ? [this.flush(address, sync, draft)]
          : [];
      }),
    );
  }
  flush(
    address: SessionAddress,
    sync: (params: DraftSyncParams) => Promise<DraftSyncResult>,
    target = this.read(address),
    requestId?: string,
    delivery?: PromptDelivery,
  ): Promise<EditorDraft> {
    target = { ...target, content: structuredClone(target.content) };
    const key = addressKey(address);
    const run = async () => {
      const draft = this.read(address);
      if (draft.retired)
        throw new Error("This draft belongs to a replaced or closed session");
      if (draft.conflict)
        throw new Error(
          "Extension changed the editor. Choose which draft to keep before sending.",
        );
      // A queued mirror must never overwrite a newer acknowledged edit.
      if (draft.version !== target.version && !draft.dirty)
        throw new Error(
          "Editor changed before synchronization; your draft has been retained",
        );
      if (!requestId && !draft.dirty) return draft;
      const flight = {
        content: target.content,
        version: target.version,
        expectedRevision: draft.revision,
      };
      this.flights.set(key, flight);
      try {
        const result = await sync({
          ...address,
          expectedRevision: flight.expectedRevision,
          content: flight.content,
          ...(requestId ? { requestId, delivery } : {}),
        });
        this.receive(address, result.draft);
        if (!result.applied) {
          const now = this.read(address);
          if (!now.retired && !equal(now.content, result.draft))
            this.put(address, { ...now, conflict: result.draft });
          throw new Error(
            "Editor revision conflict; your draft has been retained",
          );
        }
        return { ...target, revision: result.draft.revision, dirty: false };
      } finally {
        this.flights.delete(key);
      }
    };
    const pending = (this.queues.get(key) ?? Promise.resolve())
      .catch(() => {})
      .then(run);
    this.queues.set(key, pending);
    void pending
      .finally(() => {
        if (this.queues.get(key) === pending) this.queues.delete(key);
      })
      .catch(() => {});
    return pending;
  }
}
export const drafts = new DraftStore();

export function expandedDraft(content: DraftContent): string {
  return withDraftFiles(
    unfoldPastes(content.text, content.pastes).trim(),
    content.files,
    content.annotations,
  );
}
