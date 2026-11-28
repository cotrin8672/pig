import { X } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";
import { IconButton } from "../primitives/IconButton";
import { DialogFrame } from "./DialogFrame";
import "./sheet.css";

/** Always mounted so closing plays in reverse. */
export function Sheet({
  open,
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    if (open && !node.open) {
      opener.current = document.activeElement as HTMLElement | null;
      node.show();
      node
        .querySelector<HTMLElement>("input:not([type=checkbox]), .primary")
        ?.focus();
    } else if (!open && node.open) {
      node.close();
      opener.current?.focus();
    }
  }, [open]);
  return (
    <DialogFrame
      ref={dialog}
      className="mac-sheet"
      data-wide={wide || undefined}
      title={title}
      onDismiss={onClose}
      closeAction={
        <IconButton aria-label="閉じる" onClick={onClose}>
          <X size={15} aria-hidden="true" />
        </IconButton>
      }
      footer={footer}
    >
      {children}
    </DialogFrame>
  );
}
