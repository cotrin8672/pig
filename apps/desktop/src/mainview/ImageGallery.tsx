import type { ChatRendererProps } from "@pig/chat-renderers";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  X,
} from "lucide-react";
import { type MouseEvent, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChatContent } from "./ChatContent";
import { useT } from "./i18n";
import { rpc } from "./rpc";
import { showError } from "./store";

// Right-click opens the native Copy/Save menu instead of the webview's default menu.
function openImageMenu(event: MouseEvent, src: string) {
  event.preventDefault();
  event.stopPropagation();
  rpc.send.imageMenu({ src });
}

/** One large preview plus a vertical thumbnail rail for multiple images (PI-Desktop style). */
export function ImageGallery({ sources }: { sources: string[] }) {
  return (
    <ChatContent
      kind="image"
      data={{ sources }}
      builtin={BuiltinImageGallery}
    />
  );
}

export function BuiltinImageGallery({
  data: { sources },
}: ChatRendererProps<"image">) {
  const t = useT();
  const [current, setCurrent] = useState(0);
  const [viewing, setViewing] = useState(false);
  const index = Math.min(current, sources.length - 1);
  const src = sources[index];
  if (!src) return null;
  return (
    <span className={`image-set${sources.length > 1 ? " is-multiple" : ""}`}>
      <button
        type="button"
        className="image-preview"
        aria-label={t["Open image"]}
        onClick={() => setViewing(true)}
        onContextMenu={(e) => openImageMenu(e, src)}
      >
        <img src={src} alt={t.Image} loading="lazy" />
      </button>
      {sources.length > 1 && (
        <span className="image-thumbnails">
          {sources.map((thumb, i) => (
            <button
              // biome-ignore lint/suspicious/noArrayIndexKey: Message images are immutable and ordered.
              key={i}
              type="button"
              className="image-thumb"
              aria-label={t.imageN(i + 1, sources.length)}
              aria-current={i === index}
              onClick={() => setCurrent(i)}
              onContextMenu={(e) => openImageMenu(e, thumb)}
            >
              <img src={thumb} alt="" loading="lazy" />
            </button>
          ))}
        </span>
      )}
      {viewing &&
        createPortal(
          <ImageViewer
            sources={sources}
            start={index}
            onClose={(last) => {
              setCurrent(last);
              setViewing(false);
            }}
          />,
          document.body,
        )}
    </span>
  );
}

function ImageViewer({
  sources,
  start,
  onClose,
}: {
  sources: string[];
  start: number;
  onClose: (index: number) => void;
}) {
  const t = useT();
  const dialog = useRef<HTMLDialogElement>(null);
  const [index, setIndex] = useState(start);
  const [actualSize, setActualSize] = useState(false);
  const [copied, setCopied] = useState<string>();
  const src = sources[index];
  const multiple = sources.length > 1;
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  function go(step: number) {
    setIndex((i) => (i + step + sources.length) % sources.length);
    setActualSize(false);
  }
  return (
    <dialog
      ref={dialog}
      className="image-viewer electrobun-webkit-app-region-no-drag"
      aria-label={multiple ? t.imageN(index + 1, sources.length) : t.Image}
      onCancel={(e) => {
        e.preventDefault();
        onClose(index);
      }}
      onKeyDown={(e) => {
        if (multiple && e.key === "ArrowLeft") go(-1);
        else if (multiple && e.key === "ArrowRight") go(1);
      }}
    >
      <header className="image-viewer-header">
        <strong>
          {multiple ? t.imageN(index + 1, sources.length) : t.Image}
        </strong>
        <button
          type="button"
          title={t["Copy image"]}
          aria-label={t["Copy image"]}
          onClick={() =>
            void rpc.request
              .copyImage({ src })
              .then(() => setCopied(src))
              .catch(showError)
          }
        >
          {copied === src ? <Check size={18} /> : <Copy size={18} />}
        </button>
        <button
          type="button"
          title={t["Save image"]}
          aria-label={t["Save image"]}
          onClick={() => void rpc.request.saveImage({ src }).catch(showError)}
        >
          <Download size={18} />
        </button>
        <button
          type="button"
          title={t.Close}
          aria-label={t["Close image viewer"]}
          onClick={() => onClose(index)}
        >
          <X size={18} />
        </button>
      </header>
      <div className="image-viewer-body">
        {multiple && (
          <div className="image-viewer-thumbs">
            {sources.map((thumb, i) => (
              <button
                // biome-ignore lint/suspicious/noArrayIndexKey: Message images are immutable and ordered.
                key={i}
                type="button"
                className="image-thumb"
                aria-label={t.imageN(i + 1, sources.length)}
                aria-current={i === index}
                onClick={() => {
                  setIndex(i);
                  setActualSize(false);
                }}
              >
                <img src={thumb} alt="" />
              </button>
            ))}
          </div>
        )}
        <div className="image-viewer-viewport">
          <button
            type="button"
            className="image-viewer-zoom"
            data-actual={actualSize}
            aria-pressed={actualSize}
            aria-label={t["Toggle actual size"]}
            onClick={() => setActualSize(!actualSize)}
            onContextMenu={(e) => openImageMenu(e, src)}
          >
            <img src={src} alt={t.Image} />
          </button>
        </div>
      </div>
      {multiple && (
        <footer className="image-viewer-footer">
          <button
            type="button"
            aria-label={t["Previous image"]}
            title={t["Previous image"]}
            onClick={() => go(-1)}
          >
            <ChevronLeft size={18} />
          </button>
          <output>
            {index + 1} / {sources.length}
          </output>
          <button
            type="button"
            aria-label={t["Next image"]}
            title={t["Next image"]}
            onClick={() => go(1)}
          >
            <ChevronRight size={18} />
          </button>
        </footer>
      )}
    </dialog>
  );
}
