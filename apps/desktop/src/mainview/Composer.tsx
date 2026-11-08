import type { ImageContent } from "@earendil-works/pi-ai";
import { ArrowUp, Square, X } from "lucide-react";
import { useRef, useState } from "react";
import { filterModels } from "../shared/models";
import { expandMarkers, makeMarker, shouldCollapse } from "../shared/paste";
import type { Snapshot } from "../shared/rpc-schema";
import { ContextIndicator } from "./ContextIndicator";
import { useT } from "./i18n";
import { ModelPicker } from "./ModelPicker";
import { navigate } from "./navigation";
import { rpc } from "./rpc";
import { showError, useStore } from "./store";
import "./composer.css";

const imageTypes = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);
const maxBase64 = 4.5 * 1024 * 1024;
type Attachment = ImageContent & { id: number };

export function Composer({ snapshot }: { snapshot: Snapshot }) {
  const t = useT();
  const { info, transcript, model } = snapshot;
  const { models: available, disabledModels } = useStore((s) => s.bootstrap);
  const models = filterModels(available, disabledModels);
  const modelPending = useStore((s) => s.modelPending);
  const canSend = models.some(
    (m) => m.provider === model?.provider && m.id === model.id,
  );
  const [text, setText] = useState("");
  const draftVersion = useRef(0);
  const sending = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const [pastes, setPastes] = useState(new Map<number, string>());
  const nextPaste = useRef(1);
  const [images, setImages] = useState<Attachment[]>([]);
  const nextImage = useRef(1);
  // Reserve slots synchronously so overlapping clipboard/drop reads cannot exceed eight.
  const slots = useRef(0);
  const loading = useRef(0);
  const [reading, setReading] = useState(false);
  const imageBlocked = images.length > 0 && model?.vision !== true;
  const expanded = expandMarkers(text, pastes).trim();

  async function send() {
    if (
      (!expanded && !images.length) ||
      !canSend ||
      useStore.getState().modelPending ||
      imageBlocked ||
      loading.current ||
      sending.current
    )
      return;
    sending.current = true;
    setSubmitting(true);
    const version = draftVersion.current;
    try {
      await rpc.request.prompt({
        sessionId: info.id,
        text: expanded,
        images: images.length
          ? images.map(({ type, data, mimeType }) => ({ type, data, mimeType }))
          : undefined,
      });
      // Acknowledging an older submission must not erase a newer draft.
      if (draftVersion.current === version) {
        setText("");
        setPastes(new Map());
        nextPaste.current = 1;
        setImages([]);
        slots.current = 0;
      }
    } catch (error) {
      showError(error);
    } finally {
      sending.current = false;
      setSubmitting(false);
    }
  }

  async function attach(files: File[]) {
    for (const file of files) {
      if (!imageTypes.has(file.type)) {
        showError(t["Only PNG, JPEG, GIF, and WebP images are supported."]);
        continue;
      }
      if (slots.current >= 8) {
        showError(t["You can attach up to 8 images."]);
        continue;
      }
      if (4 * Math.ceil(file.size / 3) > maxBase64) {
        showError(t["Each image must be at most 4.5 MiB of base64 data."]);
        continue;
      }
      draftVersion.current++;
      slots.current++;
      loading.current++;
      setReading(true);
      const id = nextImage.current++;
      try {
        const data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () =>
            resolve(String(reader.result).replace(/^data:[^,]*;base64,/, ""));
          reader.onerror = () => reject(new Error(t["Could not read image."]));
          reader.onabort = () => reject(new Error(t["Could not read image."]));
          reader.readAsDataURL(file);
        });
        if (data.length > maxBase64) {
          throw new Error(
            t["Each image must be at most 4.5 MiB of base64 data."],
          );
        }
        setImages((current) => [
          ...current,
          { id, type: "image", data, mimeType: file.type },
        ]);
      } catch (error) {
        slots.current--;
        showError(error);
      } finally {
        loading.current--;
        setReading(loading.current > 0);
      }
    }
  }

  return (
    <div className="composer-dock">
      <form
        className="composer"
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
        }}
        onDrop={(e) => {
          e.preventDefault();
          void attach(Array.from(e.dataTransfer.files));
        }}
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        {images.length > 0 && (
          <div className="composer-attachments">
            {images.map((image) => (
              <div className="composer-attachment" key={image.id}>
                <img
                  src={`data:${image.mimeType};base64,${image.data}`}
                  alt=""
                />
                <button
                  type="button"
                  aria-label={t["Remove attachment"]}
                  title={t["Remove attachment"]}
                  onClick={() => {
                    draftVersion.current++;
                    slots.current--;
                    setImages((current) =>
                      current.filter((item) => item.id !== image.id),
                    );
                  }}
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
          onChange={(e) => {
            draftVersion.current++;
            setText(e.target.value);
          }}
          onPaste={(e) => {
            const files = Array.from(e.clipboardData.files);
            if (files.length) {
              e.preventDefault();
              void attach(files);
              return;
            }
            const pasted = e.clipboardData
              .getData("text/plain")
              .replace(/\r\n/g, "\n");
            // Small pastes stay native so the textarea's undo history keeps working.
            if (!shouldCollapse(pasted)) return;
            e.preventDefault();
            const id = nextPaste.current++;
            draftVersion.current++;
            const inserted = makeMarker(id, pasted);
            setPastes((current) => new Map(current).set(id, pasted));
            const textarea = e.currentTarget;
            const {
              selectionStart: start,
              selectionEnd: end,
              value,
            } = textarea;
            setText(value.slice(0, start) + inserted + value.slice(end));
            requestAnimationFrame(() =>
              textarea.setSelectionRange(
                start + inserted.length,
                start + inserted.length,
              ),
            );
          }}
          onKeyDown={(e) => {
            if (
              e.key === "Enter" &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing &&
              e.keyCode !== 229
            ) {
              e.preventDefault();
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
            {transcript.running && (
              <button
                type="button"
                className="send-button"
                title={t.Stop}
                aria-label={t.Stop}
                onClick={() => rpc.send.abort({ sessionId: info.id })}
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
                reading ||
                submitting
              }
            >
              <ArrowUp size={19} />
            </button>
          </div>
        </div>
      </form>
      {submitting && (
        <p className="composer-hint" role="status">
          {t["Sending…"]}
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
