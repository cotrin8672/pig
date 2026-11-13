import { Copy, Minus, Square, X } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useT } from "./i18n";

type WindowAction = "minimize" | "toggleMaximize" | "close";

export function isTitlebarHotzone(
  x: number,
  y: number,
  bounds: Pick<DOMRect, "left" | "right" | "top" | "bottom">,
  expanded = false,
) {
  const margin = expanded ? 24 : 0;
  return (
    x >= bounds.left - margin &&
    x <= bounds.right + margin &&
    y >= bounds.top - margin &&
    y <= Math.max(bounds.top + 32, bounds.bottom) + margin
  );
}

export class TitlebarHover {
  expanded = false;
  private timer?: ReturnType<typeof setTimeout>;
  private dragging = false;

  constructor(
    private show: (visible: boolean) => void,
    private isHovered: (expanded: boolean) => boolean,
  ) {}

  enter = () => {
    this.dispose();
    this.expanded = true;
    this.show(true);
  };

  leave = () => {
    if (this.dragging || this.timer !== undefined) return;
    // Native window moves can briefly report a false mouseleave.
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (!this.dragging && !this.isHovered(this.expanded)) this.reset();
    }, 300);
  };

  startDrag = () => {
    this.dragging = true;
    this.enter();
  };

  endDrag = () => {
    if (!this.dragging) return;
    this.dragging = false;
    if (this.isHovered(this.expanded)) this.enter();
    else this.leave();
  };

  reset = () => {
    this.dragging = false;
    this.dispose();
    this.expanded = false;
    this.show(false);
  };

  dispose = () => {
    clearTimeout(this.timer);
    this.timer = undefined;
  };
}

export function WindowTitlebar({
  maximized,
  onAction,
  children,
}: {
  maximized: boolean;
  onAction: (action: WindowAction) => void;
  children?: ReactNode;
}) {
  const t = useT();
  const root = useRef<HTMLDivElement>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const previousMaximized = useRef(maximized);
  const [expanded, setExpanded] = useState(false);
  const [hover] = useState(
    () =>
      new TitlebarHover(setExpanded, (expanded) => {
        const point = pointer.current;
        const bounds = root.current?.getBoundingClientRect();
        return (
          !!point &&
          !!bounds &&
          isTitlebarHotzone(point.x, point.y, bounds, expanded)
        );
      }),
  );

  useEffect(() => {
    // WebView2's native move loop may consume mouseup; recover on the next move.
    const onMouseMove = (event: MouseEvent) => {
      pointer.current = { x: event.clientX, y: event.clientY };
      const bounds = root.current?.getBoundingClientRect();
      if (
        bounds &&
        isTitlebarHotzone(event.clientX, event.clientY, bounds, hover.expanded)
      )
        hover.enter();
      else hover.leave();
      if (event.buttons === 0) hover.endDrag();
    };
    const onLeaveWindow = (event: MouseEvent) => {
      // Snapped Windows frames can report a leave just above the client area.
      pointer.current = { x: event.clientX, y: event.clientY };
      hover.leave();
    };
    const onBlur = () => {
      pointer.current = null;
      hover.reset();
    };
    window.addEventListener("mouseup", hover.endDrag);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("blur", onBlur);
    document.documentElement.addEventListener("mouseleave", onLeaveWindow);
    return () => {
      hover.dispose();
      window.removeEventListener("mouseup", hover.endDrag);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("blur", onBlur);
      document.documentElement.removeEventListener("mouseleave", onLeaveWindow);
    };
  }, [hover]);

  useEffect(() => {
    if (previousMaximized.current !== maximized) {
      previousMaximized.current = maximized;
      hover.reset();
    }
  }, [hover, maximized]);

  return (
    <div
      ref={root}
      className="window-titlebar"
      role="toolbar"
      aria-label={t["Window controls"]}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard entry point reveals the collapsed toolbar before its buttons can receive focus.
      tabIndex={0}
      data-expanded={expanded}
      onMouseDown={(event) => event.preventDefault()}
      onMouseEnter={hover.enter}
      onMouseLeave={(event) => {
        pointer.current = { x: event.clientX, y: event.clientY };
        hover.leave();
      }}
    >
      <div className="window-titlebar-content">
        {/* biome-ignore lint/a11y/noStaticElementInteractions: Native drag handle; the maximize button provides a keyboard alternative. */}
        <div
          className="window-titlebar-drag electrobun-webkit-app-region-drag"
          onMouseDown={(event) => {
            if (
              event.button === 0 &&
              event.detail === 1 &&
              event.target instanceof Element &&
              !event.target.closest(".electrobun-webkit-app-region-no-drag")
            )
              hover.startDrag();
          }}
        >
          {children}
        </div>
        <div className="window-controls electrobun-webkit-app-region-no-drag">
          <button
            type="button"
            aria-label={t.Minimize}
            title={t.Minimize}
            onClick={() => onAction("minimize")}
          >
            <Minus size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label={maximized ? t.Restore : t.Maximize}
            title={maximized ? t.Restore : t.Maximize}
            onClick={() => onAction("toggleMaximize")}
          >
            {maximized ? (
              <Copy size={12} aria-hidden="true" />
            ) : (
              <Square size={12} aria-hidden="true" />
            )}
          </button>
          <button
            type="button"
            className="window-close"
            aria-label={t["Close window"]}
            title={t.Close}
            onClick={() => onAction("close")}
          >
            <X size={15} aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}
