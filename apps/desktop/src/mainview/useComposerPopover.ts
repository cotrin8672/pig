import {
  type MouseEvent,
  type ToggleEvent,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

function place(popup: HTMLElement, anchor: Element, maxHeight: number) {
  const rect = anchor.getBoundingClientRect();
  popup.style.left = `${rect.left}px`;
  popup.style.width = `${rect.width}px`;
  popup.style.bottom = `${innerHeight - rect.top + 8}px`;
  popup.style.maxHeight = `${Math.max(120, Math.min(maxHeight, rect.top - 16))}px`;
}

/** A row of counters shares one popover, aligned to its composer. */
export function useComposerPopover<T extends string>(
  sections: readonly T[],
  maxHeight: number,
  initialSection?: T,
) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  const buttons = useRef<Partial<Record<T, HTMLButtonElement | null>>>({});
  const [open, setOpen] = useState<T | null>(initialSection ?? null);
  const shown = open !== null && sections.includes(open) ? open : null;
  useEffect(() => {
    const popup = ref.current;
    if (shown === null) {
      if (popup?.matches(":popover-open")) popup.hidePopover();
      if (open !== null) setOpen(null);
      return;
    }
    const button = buttons.current[shown];
    if (!popup || !button) return;
    const anchor = button.closest(".composer") ?? button;
    const update = () => place(popup, anchor, maxHeight);
    // A pane divider can resize the composer without resizing the window.
    const observer = new ResizeObserver(update);
    observer.observe(anchor);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [open, shown, maxHeight]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Only the initial section opens itself.
  useEffect(() => {
    const button = initialSection && buttons.current[initialSection];
    const popup = ref.current;
    if (!button || !popup) return;
    place(popup, button.closest(".composer") ?? button, maxHeight);
    popup.showPopover();
  }, []);

  return {
    shown,
    trigger: (section: T) => ({
      ref: (button: HTMLButtonElement | null) => {
        buttons.current[section] = button;
      },
      popoverTarget: id,
      popoverTargetAction: "show" as const,
      "aria-expanded": shown === section,
      "aria-controls": id,
      onClick(event: MouseEvent<HTMLButtonElement>) {
        const popup = ref.current;
        if (!popup) return;
        if (shown === section && popup.matches(":popover-open")) {
          // Cancel the native show action so the same counter can close it.
          event.preventDefault();
          popup.hidePopover();
          return;
        }
        const button = event.currentTarget;
        place(popup, button.closest(".composer") ?? button, maxHeight);
        setOpen(section);
      },
    }),
    panel: {
      ref,
      id,
      popover: "auto" as const,
      // Keyboard users need to scroll long content.
      tabIndex: 0,
      onToggle(event: ToggleEvent<HTMLDivElement>) {
        if (event.newState === "closed") setOpen(null);
      },
    },
  };
}
