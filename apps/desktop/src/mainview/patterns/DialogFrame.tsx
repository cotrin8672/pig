import { type ComponentPropsWithRef, type ReactNode, useId } from "react";
import "./dialog-frame.css";

/** Non-modal chrome; callers own opening the dialog and managing focus. */
export function DialogFrame({
  title,
  closeAction,
  onDismiss,
  footer,
  className,
  children,
  ...dialog
}: Pick<
  ComponentPropsWithRef<"dialog">,
  "ref" | "onCancel" | "className" | "children"
> & {
  title: ReactNode;
  closeAction: ReactNode;
  onDismiss: () => void;
  footer?: ReactNode;
}) {
  const heading = useId();
  return (
    <dialog
      {...dialog}
      className={className ? `dialog-frame ${className}` : "dialog-frame"}
      aria-modal="false"
      aria-labelledby={heading}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.nativeEvent.isComposing) return;
        event.preventDefault();
        event.stopPropagation();
        onDismiss();
      }}
    >
      <div className="dialog-heading">
        <h2 id={heading}>{title}</h2>
        {closeAction}
      </div>
      {children}
      {footer && <div className="dialog-actions">{footer}</div>}
    </dialog>
  );
}
