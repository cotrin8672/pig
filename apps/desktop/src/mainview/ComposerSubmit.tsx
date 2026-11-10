import { ArrowUp, Square } from "lucide-react";
import { useT } from "./i18n";

export function ComposerSubmit({
  busy,
  hasContent,
  disabled,
  onStop,
}: {
  busy: boolean;
  hasContent: boolean;
  disabled: boolean;
  onStop: () => void;
}) {
  const t = useT();
  const stop = busy && !hasContent;
  return (
    <button
      type={stop ? "button" : "submit"}
      className="send-button"
      title={stop ? t.Stop : t.Send}
      aria-label={stop ? t.Stop : t.Send}
      disabled={!stop && disabled}
      onClick={stop ? onStop : undefined}
    >
      {stop ? <Square size={15} fill="currentColor" /> : <ArrowUp size={19} />}
    </button>
  );
}
