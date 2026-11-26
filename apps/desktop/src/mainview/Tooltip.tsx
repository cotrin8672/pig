import {
  createContext,
  type FocusEvent,
  type PointerEvent,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Keycap } from "./primitives/Keycap";

/**
 * App-wide Tooltip on the shared `ui-tooltip` surface (tooltip.css,
 * docs/ui-guidelines.md「ツールチップ」). One top-layer popover per
 * `TooltipLayer` swaps content/position; delayed open, then instant while
 * moving across neighbours. Gapless neighbours (session rows) keep it open:
 * it glides to the new anchor and only the content cross-fades. Keyboard focus-visible opens it; Escape, scroll of
 * an anchor's container, resize and pointer-down close it.
 */
export type TooltipTier = "label" | "shortcut" | "detail" | "rich";
export type TooltipSide = "right" | "top" | "bottom";
export type TipContent = {
  tier: TooltipTier;
  label: string;
  keys?: string[];
  description?: string;
  /** Full monospace text (e.g. a clipped shell command), up to 8 lines. */
  code?: string;
  rows?: [string, ReactNode][];
  /** One small command inside the surface. Makes this tooltip hoverable: it
   * stays open while the pointer crosses the gap into it. Keep a keyboard
   * route elsewhere, since the anchor itself need not be focusable. */
  action?: { label: string; run: () => void; disabled?: boolean };
};
export type TooltipAnchor = TipContent & { side: TooltipSide };
type Source = TooltipAnchor | (() => TooltipAnchor);
/** `shown` re-keys the content so a switch replays its cross-fade. */
type ShownTip = TooltipAnchor & { shown: number };
type Schedule = (el: HTMLElement, source: Source) => void;

const OPEN_DELAY = 500;
const WARM_FOR = 400;
/** Time to cross the gap from an anchor into a hoverable tooltip. */
const LEAVE_GRACE = 200;
const GAP = 6;
/** Long titles must not grow the tooltip into a wall of text. */
export const TOOLTIP_TEXT_LIMIT = 80;

export const clipTooltipText = (text: string, limit = TOOLTIP_TEXT_LIMIT) => {
  const chars = [...text.replace(/\s+/g, " ").trim()];
  return chars.length > limit
    ? `${chars.slice(0, limit - 1).join("")}…`
    : chars.join("");
};

const TooltipContext = createContext<{
  schedule: Schedule;
  close: () => void;
  leave: () => void;
} | null>(null);

function Keys({ keys }: { keys?: string[] }) {
  if (!keys) return null;
  return (
    <span className="tooltip-keys">
      {keys.map((key) => (
        <Keycap key={key}>{key}</Keycap>
      ))}
    </span>
  );
}

export function TooltipBody({ content }: { content: TipContent }) {
  const { tier, label, keys, description, code, rows, action } = content;
  if (tier === "label")
    return <span className="tooltip-label ui-tooltip-title">{label}</span>;
  if (tier === "shortcut")
    return (
      <>
        <span className="tooltip-label ui-tooltip-title">{label}</span>
        <Keys keys={keys} />
      </>
    );
  return (
    <>
      {(label || keys) && (
        <span className="tooltip-head ui-tooltip-title">
          <span className="tooltip-label">{label}</span>
          <Keys keys={keys} />
        </span>
      )}
      {description && <span className="tooltip-desc">{description}</span>}
      {code && <code className="tooltip-code">{code}</code>}
      {rows && (
        <dl className="tooltip-rows">
          {rows.map(([key, value]) => (
            <div key={key}>
              <dt>{key}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {action && (
        <button
          type="button"
          className="tooltip-action"
          disabled={action.disabled}
          onClick={action.run}
        >
          {action.label}
        </button>
      )}
    </>
  );
}

export const tooltipClass = (tier: TooltipTier) =>
  `tooltip ui-tooltip tooltip-tier-${tier}`;

/** Provides the single tooltip popover for everything rendered inside. */
export function TooltipLayer({ children }: { children: ReactNode }) {
  const id = useId();
  const panel = useRef<HTMLDivElement>(null);
  const anchor = useRef<HTMLElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const closedAt = useRef(0);
  const shown = useRef(0);
  const [tip, setTip] = useState<ShownTip>();
  const interactive = useRef(false);
  interactive.current = !!tip?.action;
  const close = useCallback(() => {
    clearTimeout(timer.current);
    if (anchor.current) closedAt.current = Date.now();
    anchor.current = null;
    setTip(undefined);
  }, []);
  const leave = useCallback(() => {
    if (!interactive.current) return close();
    clearTimeout(timer.current);
    timer.current = setTimeout(close, LEAVE_GRACE);
  }, [close]);
  const schedule = useCallback<Schedule>((el, source) => {
    clearTimeout(timer.current);
    // Back from a hoverable tooltip to its own anchor: keep it as it is.
    if (anchor.current === el) return;
    // An open menu/popover already explains itself; don't cover it.
    if (el.matches('[aria-expanded="true"], details[open] > summary')) return;
    const show = () => {
      if (!el.isConnected) return;
      anchor.current = el;
      const content = typeof source === "function" ? source() : source;
      setTip({ ...content, shown: ++shown.current });
    };
    if (anchor.current || Date.now() - closedAt.current < WARM_FOR) show();
    else timer.current = setTimeout(show, OPEN_DELAY);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  useLayoutEffect(() => {
    const popup = panel.current;
    const el = anchor.current;
    if (!tip || !popup || !el) return;
    if (!popup.matches(":popover-open")) popup.showPopover();
    const box = el.getBoundingClientRect();
    const { width, height } = popup.getBoundingClientRect();
    let side: TooltipSide | "left" = tip.side;
    let left = box.left + box.width / 2 - width / 2;
    let top: number;
    if (side === "right") {
      left = box.right + GAP;
      top = box.top + box.height / 2 - height / 2;
      if (left + width > innerWidth - GAP) {
        left = box.left - width - GAP;
        side = "left";
      }
    } else if (side === "top") {
      top = box.top - height - GAP;
      if (top < GAP) [top, side] = [box.bottom + GAP, "bottom"];
    } else {
      top = box.bottom + GAP;
      if (top + height > innerHeight - GAP)
        [top, side] = [box.top - height - GAP, "top"];
    }
    popup.style.left = `${Math.max(GAP, Math.min(left, innerWidth - width - GAP))}px`;
    popup.style.top = `${Math.max(GAP, Math.min(top, innerHeight - height - GAP))}px`;
    popup.dataset.side = side;
    const described = el.getAttribute("aria-describedby");
    el.setAttribute("aria-describedby", id);
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    // Only scrolling that moves the anchor closes it (not a streaming chat).
    const scroll = (event: Event) => {
      if (event.target instanceof Node && event.target.contains(el)) close();
    };
    document.addEventListener("keydown", dismiss);
    document.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", close);
    return () => {
      if (described === null) el.removeAttribute("aria-describedby");
      else el.setAttribute("aria-describedby", described);
      document.removeEventListener("keydown", dismiss);
      document.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", close);
    };
  }, [tip, close, id]);
  const api = useMemo(
    () => ({ schedule, close, leave }),
    [schedule, close, leave],
  );
  const action = tip?.action;
  return (
    <TooltipContext.Provider value={api}>
      {children}
      {tip && (
        <div
          ref={panel}
          id={id}
          // A tooltip may not hold controls; a hoverable one is a plain group.
          role={action ? "group" : "tooltip"}
          popover="manual"
          className={`${tooltipClass(tip.tier)} ui-tooltip-follow`}
          data-interactive={action ? "" : undefined}
          onPointerEnter={() => clearTimeout(timer.current)}
          onPointerLeave={action ? leave : undefined}
        >
          <div key={tip.shown} className="tooltip-content ui-tooltip-swap">
            <TooltipBody
              content={
                action
                  ? {
                      ...tip,
                      action: {
                        ...action,
                        run: () => {
                          close();
                          action.run();
                        },
                      },
                    }
                  : tip
              }
            />
          </div>
        </div>
      )}
    </TooltipContext.Provider>
  );
}

/**
 * Returns a props builder for anchors. Pass a function to compute content
 * lazily at hover time (e.g. relative dates). Outside a `TooltipLayer` it is a
 * no-op, so components still render standalone.
 */
export function useTooltip() {
  const layer = useContext(TooltipContext);
  return (source: Source) =>
    layer
      ? {
          "data-tooltip-anchor": "",
          onPointerEnter: (event: PointerEvent<HTMLElement>) =>
            layer.schedule(event.currentTarget, source),
          onPointerLeave: layer.leave,
          onPointerDown: layer.close,
          onFocus: (event: FocusEvent<HTMLElement>) => {
            if (event.currentTarget.matches(":focus-visible"))
              layer.schedule(event.currentTarget, source);
          },
          onBlur: layer.close,
        }
      : {};
}
