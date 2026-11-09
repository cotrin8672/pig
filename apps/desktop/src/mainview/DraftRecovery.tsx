import { useSyncExternalStore } from "react";
import { addressKey } from "./chat-snapshot";
import { dataText } from "./custom-data";
import { drafts, expandedDraft } from "./draft-store";
import { ImageGallery } from "./ImageGallery";
import { useStore } from "./store";

/** Retained old-host drafts are inspectable, not silently reassigned to a new runtime. */
export function DraftRecovery() {
  useSyncExternalStore(drafts.subscribe, drafts.getTick);
  const active = useStore((state) =>
    state.active ? state.snapshots[state.active] : undefined,
  );
  const retained = drafts.retained();
  if (!retained.length) return null;
  return (
    <details className="draft-recovery">
      <summary>Retained drafts ({retained.length})</summary>
      <p>
        These drafts belonged to a closed/restarted runtime. A previous send may
        have executed. Inspect history before explicitly copying a draft into a
        new session. Nothing is resent automatically.
      </p>
      {retained.map(({ address, draft }) => (
        <details key={addressKey(address)}>
          <summary>
            {address.sessionId} · epoch {address.epoch}
          </summary>
          <pre>{expandedDraft(draft.content)}</pre>
          <ImageGallery
            sources={draft.content.images.map(
              ({ image }) => `data:${image.mimeType};base64,${image.data}`,
            )}
          />
          <details>
            <summary>Raw draft / folded pastes</summary>
            <pre>{dataText(draft.content)}</pre>
          </details>
          <button
            type="button"
            disabled={!active}
            onClick={() => {
              if (
                active &&
                window.confirm(
                  "I inspected history and understand the old send may have executed. Copy this retained draft into the current SDK session? This replaces its current draft but does not send it.",
                )
              )
                drafts.edit(active.address, () => draft.content);
            }}
          >
            Copy into current SDK session after reviewing history
          </button>
        </details>
      ))}
    </details>
  );
}
