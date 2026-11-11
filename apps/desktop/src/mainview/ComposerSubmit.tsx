import { ArrowUp, LoaderCircle, Square } from "lucide-react";
import { useT } from "./i18n";

export function ComposerSubmit({
  busy,
  submitting = false,
  stopping = false,
  hasContent,
  disabled,
  onStop,
}: {
  busy: boolean;
  submitting?: boolean;
  stopping?: boolean;
  hasContent: boolean;
  disabled: boolean;
  onStop: () => void;
}) {
  const t = useT();
  return (
    <>
      {(busy || submitting || stopping) && (
        <button
          type="button"
          className="send-button"
          title={stopping ? "Stopping…" : busy ? t.Stop : "Cancel send"}
          aria-label={stopping ? "Stopping…" : busy ? t.Stop : "Cancel send"}
          aria-keyshortcuts="Escape"
          aria-busy={stopping || undefined}
          disabled={stopping}
          onClick={onStop}
        >
          <Square size={15} fill="currentColor" aria-hidden="true" />
        </button>
      )}
      {(!busy || hasContent || submitting) && (
        <button
          type={submitting ? "button" : "submit"}
          className="send-button"
          title={submitting ? t["Sending…"] : t.Send}
          aria-label={submitting ? t["Sending…"] : t.Send}
          aria-busy={submitting || undefined}
          disabled={submitting || stopping || disabled}
        >
          {submitting ? (
            <LoaderCircle size={19} className="spinner" aria-hidden="true" />
          ) : (
            <ArrowUp size={19} aria-hidden="true" />
          )}
        </button>
      )}
    </>
  );
}
