import { ArrowUp, LoaderCircle, Square } from "lucide-react";
import { useT } from "./i18n";

/**
 * One button, three states: Send when idle, a spinner only while the app truly
 * waits (a send not yet started, or Stop not yet confirmed), Stop while the
 * response runs. A next message typed during a response keeps its own Send.
 */
export function ComposerSubmit({
  busy,
  waiting = false,
  stopping = false,
  hasContent,
  disabled,
  onStop,
}: {
  busy: boolean;
  waiting?: boolean;
  stopping?: boolean;
  hasContent: boolean;
  disabled: boolean;
  onStop: () => void;
}) {
  const t = useT();
  const send = (
    <button
      type="submit"
      className="send-button"
      title={t.Send}
      aria-label={t.Send}
      disabled={disabled}
    >
      <ArrowUp size={19} aria-hidden="true" />
    </button>
  );
  if (stopping || (waiting && !busy))
    return (
      <button
        type="button"
        className="send-button waiting"
        title={stopping ? "Stopping…" : "Cancel send"}
        aria-label={stopping ? "Stopping…" : "Cancel send"}
        aria-keyshortcuts="Escape"
        aria-busy="true"
        disabled={stopping}
        onClick={onStop}
      >
        <LoaderCircle size={17} className="spinner" aria-hidden="true" />
      </button>
    );
  if (!busy) return send;
  return (
    <>
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
      {hasContent && send}
    </>
  );
}
