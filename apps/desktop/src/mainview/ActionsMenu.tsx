import { MoreHorizontal } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";

/** Shared native popover, positioning and keyboard behavior for sidebar actions. */
export function ActionsMenu({
  label,
  disabled,
  children,
  onOpen,
}: {
  label: string;
  disabled?: boolean;
  children: (close: () => void) => ReactNode;
  onOpen?: () => void;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();
  const [open, setOpen] = useState(false);
  function close() {
    if (menu.current?.matches(":popover-open")) menu.current.hidePopover();
  }
  useEffect(() => {
    if (!open) return;
    const close = () => {
      if (menu.current?.matches(":popover-open")) menu.current.hidePopover();
    };
    const list = trigger.current?.closest(".project-list");
    list?.addEventListener("scroll", close);
    window.addEventListener("resize", close);
    return () => {
      list?.removeEventListener("scroll", close);
      window.removeEventListener("resize", close);
    };
  }, [open]);
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="thread-more"
        popoverTarget={id}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
        disabled={disabled}
        onClick={() => {
          if (menu.current?.matches(":popover-open")) return;
          onOpen?.();
          requestAnimationFrame(() => {
            const popup = menu.current,
              button = trigger.current;
            if (!popup?.matches(":popover-open") || !button) return;
            const anchor = button.getBoundingClientRect(),
              panel = popup.getBoundingClientRect();
            popup.style.left = `${Math.max(8, Math.min(innerWidth - panel.width - 8, anchor.right - panel.width))}px`;
            popup.style.top = `${Math.max(8, Math.min(innerHeight - panel.height - 8, anchor.bottom + panel.height + 4 <= innerHeight - 8 ? anchor.bottom + 4 : anchor.top - panel.height - 4))}px`;
            popup
              .querySelector<HTMLButtonElement>("button:not(:disabled)")
              ?.focus();
          });
        }}
      >
        <MoreHorizontal size={15} />
      </button>
      <div
        ref={menu}
        id={id}
        popover="auto"
        className="session-menu"
        role="menu"
        aria-label={label}
        onToggle={() => setOpen(!!menu.current?.matches(":popover-open"))}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            close();
            trigger.current?.focus();
            return;
          }
          if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key))
            return;
          event.preventDefault();
          const buttons = Array.from(
            event.currentTarget.querySelectorAll<HTMLButtonElement>(
              "button:not(:disabled)",
            ),
          );
          const index = buttons.indexOf(
            document.activeElement as HTMLButtonElement,
          );
          const next =
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? buttons.length - 1
                : (index +
                    (event.key === "ArrowDown" ? 1 : -1) +
                    buttons.length) %
                  buttons.length;
          buttons[next]?.focus();
        }}
      >
        {children(close)}
      </div>
    </>
  );
}
