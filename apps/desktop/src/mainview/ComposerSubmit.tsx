import { ArrowUp, Square } from "lucide-react";
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
          type="submit"
          className="send-button"
          title={t.Send}
          aria-label={t.Send}
          disabled={stopping || disabled}
        >
          <ArrowUp size={19} aria-hidden="true" />
        </button>
      )}
    </>
  );
}
