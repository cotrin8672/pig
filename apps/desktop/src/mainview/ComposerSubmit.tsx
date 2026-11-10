import { ArrowUp, LoaderCircle, Square } from "lucide-react";
import { useT } from "./i18n";

export function ComposerSubmit({
  busy,
  submitting = false,
  hasContent,
  disabled,
  onStop,
}: {
  busy: boolean;
  submitting?: boolean;
  hasContent: boolean;
  disabled: boolean;
  onStop: () => void;
}) {
  const t = useT();
  const stop = !submitting && busy && !hasContent;
  const label = submitting ? t["Sending…"] : stop ? t.Stop : t.Send;
  return (
    <button
      type={stop || submitting ? "button" : "submit"}
      className="send-button"
      title={label}
      aria-label={label}
      aria-busy={submitting || undefined}
      disabled={submitting || (!stop && disabled)}
      onClick={stop ? onStop : undefined}
    >
      {submitting ? (
        <LoaderCircle size={19} className="spinner" aria-hidden="true" />
      ) : stop ? (
        <Square size={15} fill="currentColor" aria-hidden="true" />
      ) : (
        <ArrowUp size={19} aria-hidden="true" />
      )}
    </button>
  );
}
