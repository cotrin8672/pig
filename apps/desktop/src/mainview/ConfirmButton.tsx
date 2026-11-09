import {
  type ButtonHTMLAttributes,
  type ReactNode,
  useEffect,
  useState,
} from "react";
import { useT } from "./i18n";

/** How long the armed state waits for the second press. Matches the ring animation. */
const ARMED_MS = 3000;

/**
 * Two-press confirmation instead of a modal dialog: the first press arms the
 * button (a countdown ring runs around it), a second press within ARMED_MS
 * runs `onConfirm`. Timeout, Escape or losing focus disarms it. Both labels
 * share one grid cell, so the button never changes width.
 */
export function ConfirmButton({
  onConfirm,
  children,
  className = "",
  ...rest
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick" | "type"> & {
  onConfirm: () => void;
  children: ReactNode;
}) {
  const t = useT();
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), ARMED_MS);
    return () => clearTimeout(timer);
  }, [armed]);
  return (
    <button
      {...rest}
      type="button"
      className={`confirm-button ${className} ${armed ? "armed" : ""}`}
      onClick={() => {
        if (!armed) return setArmed(true);
        setArmed(false);
        onConfirm();
      }}
      onBlur={(event) => {
        setArmed(false);
        rest.onBlur?.(event);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && armed) {
          event.preventDefault();
          event.stopPropagation();
          setArmed(false);
          return;
        }
        rest.onKeyDown?.(event);
      }}
    >
      <span className="confirm-label">
        <span className="confirm-idle" aria-hidden={armed}>
          {children}
        </span>
        <span className="confirm-armed" aria-hidden={!armed}>
          {t.Confirm}
        </span>
      </span>
      <span className="confirm-status" aria-live="polite">
        {armed ? t["Press again to confirm"] : ""}
      </span>
    </button>
  );
}
