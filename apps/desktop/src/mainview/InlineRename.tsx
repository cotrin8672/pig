import { useState } from "react";

/** Edits a title in place: Enter or leaving the field commits, Escape restores. */
export function InlineRename({
  value,
  label,
  placeholder,
  allowEmpty = false,
  onCommit,
  onDone,
}: {
  value: string;
  label: string;
  placeholder?: string;
  allowEmpty?: boolean;
  onCommit: (value: string) => void;
  onDone: () => void;
}) {
  const [draft, setDraft] = useState(value);
  let settled = false;
  const finish = (commit: boolean) => {
    if (settled) return;
    settled = true;
    const next = draft.trim();
    if (commit && next !== value.trim() && (next || allowEmpty)) onCommit(next);
    onDone();
  };
  return (
    <input
      className="inline-rename"
      aria-label={label}
      placeholder={placeholder}
      value={draft}
      maxLength={512}
      ref={(input) => {
        if (input && !input.dataset.focused) {
          input.dataset.focused = "true";
          input.focus();
          input.select();
        }
      }}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (event.key === "Enter") {
          event.preventDefault();
          finish(true);
        } else if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          finish(false);
        }
      }}
    />
  );
}
