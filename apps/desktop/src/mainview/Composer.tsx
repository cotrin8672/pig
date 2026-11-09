import { ArrowUp, Square, X } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { filterModels } from "../shared/models";
import { makeMarker, shouldCollapse } from "../shared/paste";
import type { Snapshot } from "../shared/rpc-schema";
import { ContextIndicator } from "./ContextIndicator";
import { addressKey } from "./chat-snapshot";
import { drafts, expandedDraft } from "./draft-store";
import { ExtensionWidgets } from "./extension-status";
import { useT } from "./i18n";
import { ModelPicker } from "./ModelPicker";
import { navigate } from "./navigation";
import { rpc, sends } from "./rpc";
import { showError, useStore } from "./store";
import "./composer.css";

const imageTypes = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);
const maxBase64 = 4.5 * 1024 * 1024;
const pendingReads = new Map<string, number>();
const readListeners = new Set<() => void>();
const subscribeReads = (listener: () => void) => {
  readListeners.add(listener);
  return () => {
    readListeners.delete(listener);
  };
};
function changeReads(key: string, delta: number) {
  pendingReads.set(key, (pendingReads.get(key) ?? 0) + delta);
  for (const listener of readListeners) listener();
}
export function Composer({ snapshot }: { snapshot: Snapshot }) {
  const t = useT();
  const { address, transcript, model } = snapshot;
  const key = addressKey(address);
  const { models: available, disabledModels } = useStore((s) => s.bootstrap);
  const models = filterModels(available, disabledModels);
  const modelPending = useStore((s) => s.modelPending);
  const canSend = models.some(
    (m) => m.provider === model?.provider && m.id === model.id,
  );
  const draft = useSyncExternalStore(drafts.subscribe, () =>
    drafts.read(address),
  );
  const sendState = useSyncExternalStore(sends.subscribe, () =>
    sends.read(address),
  );
  const reading = useSyncExternalStore(
    subscribeReads,
    () => pendingReads.get(key) ?? 0,
  );
  const { text, images, pastes } = draft.content;
  const [mirrorError, setMirrorError] = useState<string>();
  const nextPaste = useRef(1);
  const imageBlocked = images.length > 0 && model?.vision !== true;
  const expanded = expandedDraft(draft.content);
  const submitting =
    sendState?.state === "sending" || sendState?.state === "checking";
  const uncertain = sendState?.state === "unknown";
  // Background mirror is not the command barrier: send still awaits the ordered CAS queue.
  useEffect(() => {
    if (!draft.dirty || draft.conflict || draft.retired) return;
    const timer = setTimeout(() => {
      void drafts
        .flush(address, (params) => rpc.request.syncDraft(params))
        .then(
          () => setMirrorError(undefined),
          (error) => setMirrorError(String(error)),
        );
    }, 120);
    return () => clearTimeout(timer);
  }, [address, draft]);
  function send() {
    if (
      (!expanded && !images.length) ||
      !canSend ||
      useStore.getState().modelPending ||
      imageBlocked ||
      reading ||
      submitting ||
      uncertain ||
      draft.conflict
    )
      return;
    void sends.send(address).catch(showError);
  }
  async function attach(files: File[]) {
    // Capture the address, not whichever session happens to be active at FileReader completion.
    for (const file of files) {
      if (!imageTypes.has(file.type)) {
        showError(t["Only PNG, JPEG, GIF, and WebP images are supported."]);
        continue;
      }
      if (
        drafts.read(address).content.images.length +
          (pendingReads.get(key) ?? 0) >=
        8
      ) {
        showError(t["You can attach up to 8 images."]);
        continue;
      }
      if (4 * Math.ceil(file.size / 3) > maxBase64) {
        showError(t["Each image must be at most 4.5 MiB of base64 data."]);
        continue;
      }
      changeReads(key, 1);
      try {
        const data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () =>
            resolve(String(reader.result).replace(/^data:[^,]*;base64,/, ""));
          reader.onerror = reader.onabort = () =>
            reject(new Error(t["Could not read image."]));
          reader.readAsDataURL(file);
        });
        if (data.length > maxBase64)
          throw new Error(
            t["Each image must be at most 4.5 MiB of base64 data."],
          );
        drafts.edit(address, (content) => ({
          ...content,
          images: [
            ...content.images,
            {
              id: crypto.randomUUID(),
              image: { type: "image", data, mimeType: file.type },
            },
          ],
        }));
      } catch (error) {
        showError(error);
      } finally {
        changeReads(key, -1);
      }
    }
  }
  return (
    <div className="composer-dock">
      <ExtensionWidgets address={address} placement="aboveEditor" />
      {draft.conflict && (
        <section className="draft-conflict" role="alert">
          <p>
            An extension changed this editor while you were typing. Both drafts
            were retained.
          </p>
          <details>
            <summary>Extension draft</summary>
            <pre>{draft.conflict.text}</pre>
          </details>
          <button
            type="button"
            onClick={() => drafts.resolve(address, "local")}
          >
            Keep my draft
          </button>
          <button
            type="button"
            onClick={() => drafts.resolve(address, "extension")}
          >
            Use extension draft
          </button>
        </section>
      )}
      <form
        className="composer"
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        }}
        onDrop={(event) => {
          event.preventDefault();
          void attach(Array.from(event.dataTransfer.files));
        }}
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        {images.length > 0 && (
          <div className="composer-attachments">
            {images.map(({ id, image }) => (
              <div className="composer-attachment" key={id}>
                <img
                  src={`data:${image.mimeType};base64,${image.data}`}
                  alt=""
                />
                <button
                  type="button"
                  aria-label={t["Remove attachment"]}
                  title={t["Remove attachment"]}
                  onClick={() =>
                    drafts.edit(address, (content) => ({
                      ...content,
                      images: content.images.filter((item) => item.id !== id),
                    }))
                  }
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
        <textarea
          aria-label={t.Message}
          placeholder={
            transcript.running
              ? t["Send a follow-up…"]
              : t["Ask anything, or describe what to build…"]
          }
          rows={2}
          value={text}
          onChange={(event) =>
            drafts.edit(address, (content) => ({
              ...content,
              text: event.target.value,
            }))
          }
          onPaste={(event) => {
            const files = Array.from(event.clipboardData.files);
            if (files.length) {
              event.preventDefault();
              void attach(files);
              return;
            }
            const pasted = event.clipboardData
              .getData("text/plain")
              .replace(/\r\n/g, "\n");
            if (!shouldCollapse(pasted)) return;
            event.preventDefault();
            let id = nextPaste.current++;
            while (
              pastes.some((paste) => paste.marker === makeMarker(id, pasted))
            )
              id = nextPaste.current++;
            const marker = makeMarker(id, pasted);
            const textarea = event.currentTarget;
            const {
              selectionStart: start,
              selectionEnd: end,
              value,
            } = textarea;
            drafts.edit(address, (content) => ({
              ...content,
              text: value.slice(0, start) + marker + value.slice(end),
              pastes: [
                ...content.pastes,
                { id: crypto.randomUUID(), marker, text: pasted },
              ],
            }));
            requestAnimationFrame(() =>
              textarea.setSelectionRange(
                start + marker.length,
                start + marker.length,
              ),
            );
          }}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing &&
              event.keyCode !== 229
            ) {
              event.preventDefault();
              send();
            }
          }}
        />
        <div className="composer-toolbar">
          <div className="composer-pickers">
            <ContextIndicator usage={snapshot.contextUsage} />
            <ModelPicker snapshot={snapshot} />
          </div>
          <div className="send-controls">
            {(transcript.running || submitting) && (
              <button
                type="button"
                className="send-button"
                title={t.Stop}
                aria-label={t.Stop}
                onClick={() => void rpc.request.abort(address).catch(showError)}
              >
                <Square size={15} fill="currentColor" />
              </button>
            )}
            <button
              type="submit"
              className="send-button"
              aria-label={transcript.running ? t["Queue follow-up"] : t.Send}
              disabled={
                (!expanded && !images.length) ||
                !canSend ||
                modelPending ||
                imageBlocked ||
                reading > 0 ||
                submitting ||
                uncertain ||
                !!draft.conflict
              }
            >
              <ArrowUp size={19} />
            </button>
          </div>
        </div>
      </form>
      <ExtensionWidgets address={address} placement="belowEditor" />
      {sendState?.message && (
        <p className="composer-hint" role="status">
          {sendState.message}
        </p>
      )}
      {uncertain && (
        <button
          type="button"
          onClick={() => {
            if (
              window.confirm(
                "This send may already have executed. Have you inspected history and do you want to enable a NEW send?",
              )
            )
              sends.confirmNewSend(address);
          }}
        >
          I inspected history — enable a new send
        </button>
      )}
      {sendState?.state === "sending" && (
        <p className="composer-hint" role="status">
          {t["Sending…"]}
        </p>
      )}
      {mirrorError && (
        <p className="composer-hint" role="alert">
          {mirrorError}
        </p>
      )}
      {imageBlocked && (
        <p className="composer-hint">
          {
            t[
              "The current model can't read images. Switch to a vision model or remove the images."
            ]
          }
        </p>
      )}
      {!canSend && (
        <p className="composer-hint">
          {t["Choose an enabled model to send a message."]}{" "}
          <button type="button" onClick={() => navigate("providers")}>
            {t["Manage models"]}
          </button>
        </p>
      )}
    </div>
  );
}
