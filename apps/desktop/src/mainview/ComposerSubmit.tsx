import { ArrowUp, LoaderCircle, Play, Square } from "lucide-react";
import { useT } from "./i18n";

/**
 * One action slot: Send, Resume after interruption, pending spinner, or Stop.
 * A typed next message replaces Stop with Send; pending spinners are disabled.
 */
export function ComposerSubmit({
  busy,
  waiting = false,
  stopping = false,
  resumable = false,
  hasContent,
  disabled,
  onStop,
}: {
  busy: boolean;
  waiting?: boolean;
  stopping?: boolean;
  resumable?: boolean;
  hasContent: boolean;
  disabled: boolean;
  onStop: () => void;
}) {
  const t = useT();
  const resume = resumable && !hasContent;
  const send = (
    <button
      type="submit"
      className="send-button"
      title={resume ? t.Resume : t.Send}
      aria-label={resume ? t.Resume : t.Send}
      disabled={disabled}
    >
      {resume ? (
        <Play size={17} fill="currentColor" aria-hidden="true" />
      ) : (
        <ArrowUp size={19} aria-hidden="true" />
      )}
    </button>
  );
  if (stopping || waiting)
    return (
      <button
        type="button"
        className="send-button waiting"
        title={stopping ? "Stopping…" : t["Sending…"]}
        aria-label={stopping ? "Stopping…" : t["Sending…"]}
        aria-busy="true"
        disabled
      >
        <LoaderCircle size={17} className="spinner" aria-hidden="true" />
      </button>
    );
  if (!busy || hasContent) return send;
  return (
    <button
      type="button"
      className="send-button"
      title={t.Stop}
      aria-label={t.Stop}
      aria-keyshortcuts="Escape"
      onClick={onStop}
    >
      <Square size={15} fill="currentColor" aria-hidden="true" />
    </button>
  );
}
