import type {
  DraftContent,
  DraftState,
  DraftSyncParams,
  DraftSyncResult,
  SessionAddress,
} from "../shared/runtime-contract";
import { addressKey } from "./chat-snapshot";

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
};
type Flight = {
  content: DraftContent;
  expectedRevision: number;
  version: number;
};
const contentOf = ({ text, pastes, images }: DraftContent): DraftContent => ({
  text,
  pastes,
  images,
});
const equal = (a: DraftContent, b: DraftContent) =>
  a.text === b.text &&
  JSON.stringify(a.pastes) === JSON.stringify(b.pastes) &&
  JSON.stringify(a.images) === JSON.stringify(b.images);
/** Address-owned drafts outlive React mounts, tab navigation and asynchronous file reads. */
export class DraftStore {
  private entries = new Map<string, EditorDraft>();
  private owners = new Map<string, SessionAddress>();
  private tick = 0;
  getTick = () => this.tick;
  retained() {
    return [...this.owners].flatMap(([key, address]) => {
      const draft = this.entries.get(key);
      return draft?.retired &&
        !draft.transferred &&
        (draft.content.text || draft.content.images.length)
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
  ) {
    const draft = this.read(address);
    if (draft.retired) return;
    this.put(address, {
      ...draft,
      content: change(draft.content),
      version: draft.version + 1,
      dirty: true,
    });
  }
  receive(address: SessionAddress, remote: DraftState) {
    const draft = this.read(address);
    if (draft.retired || remote.revision < draft.revision) return;
    const flight = this.flights.get(addressKey(address));
    const own =
      flight &&
      remote.revision === flight.expectedRevision + 1 &&
      equal(remote, flight.content);
    if (own || equal(draft.content, remote)) {
      this.put(address, {
        ...draft,
        revision: remote.revision,
        dirty: !equal(draft.content, remote),
        conflict: undefined,
      });
    } else if (remote.revision === draft.revision) {
      // Initial/repeated state cannot overwrite unsynced edits.
      if (!draft.dirty)
        this.put(address, { ...draft, content: contentOf(remote) });
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
    const old = this.read(previous);
    this.put(previous, { ...old, retired: true, transferred: true });
    const current = this.read(next);
    // A new epoch's startup editor event may beat the replaced publication.
    // Never overwrite that newer extension text with a clean old mirror.
    if (!old.dirty && current.revision > 0) return;
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
      version: Math.max(old.version, current.version) + 1,
    });
  }
  retire(address: SessionAddress) {
    const draft = this.read(address);
    this.put(address, { ...draft, retired: true });
  }
  clearAccepted(address: SessionAddress, sentVersion: number) {
    const draft = this.read(address);
    if (draft.retired || draft.version !== sentVersion || draft.conflict)
      return false;
    this.edit(address, emptyContent);
    return true;
  }
  flush(
    address: SessionAddress,
    sync: (params: DraftSyncParams) => Promise<DraftSyncResult>,
  ): Promise<EditorDraft> {
    const key = addressKey(address);
    const run = async () => {
      // Serialize the mirror before every command/send, including edits made during an ACK.
      while (true) {
        const draft = this.read(address);
        if (draft.retired)
          throw new Error("This draft belongs to a replaced or closed session");
        if (draft.conflict)
          throw new Error(
            "Extension changed the editor. Choose which draft to keep before sending.",
          );
        if (!draft.dirty) return draft;
        const flight = {
          content: draft.content,
          version: draft.version,
          expectedRevision: draft.revision,
        };
        this.flights.set(key, flight);
        try {
          const result = await sync({
            ...address,
            expectedRevision: flight.expectedRevision,
            content: flight.content,
          });
          this.receive(address, result.draft);
          if (!result.applied) {
            const now = this.read(address);
            if (!equal(now.content, result.draft))
              this.put(address, { ...now, conflict: result.draft });
            throw new Error(
              "Editor revision conflict; your draft has been retained",
            );
          }
        } finally {
          this.flights.delete(key);
        }
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
  const pastes = new Map(
    content.pastes.map((paste) => [paste.marker, paste.text]),
  );
  return content.text
    .replace(
      /\[paste #\d+ (?:\+\d+ lines|\d+ chars)\]/g,
      (marker) => pastes.get(marker) ?? marker,
    )
    .trim();
}
