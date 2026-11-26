import { Split } from "lucide-react";
import {
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { TranscriptRecord } from "../shared/transcript";
import { useT } from "./i18n";
import { forkChat } from "./rpc";
import { showError, useStore } from "./store";
import { collectTurns, type Turn } from "./turn-rail-model";
import "./turn-rail.css";

/** Marks the edges that still have ticks beyond them (fade mask). */
function markEdges(ticks: HTMLElement) {
  const { scrollTop, clientHeight, scrollHeight } = ticks;
  ticks.toggleAttribute("data-more-top", scrollTop > 1);
  ticks.toggleAttribute(
    "data-more-bottom",
    scrollTop + clientHeight < scrollHeight - 1,
  );
}

/**
 * Dock-style swell: ticks lengthen by their distance to `y` (px from the
 * top of the scrolled tick list). Written to style directly so pointer moves skip React renders.
 * `y` undefined resets every tick.
 */
function swell(ticks: Element | null, y?: number) {
  if (!(ticks instanceof HTMLElement)) return;
  const children = Array.from(ticks.children as HTMLCollectionOf<HTMLElement>);
  if (y === undefined) {
    for (const tick of children) tick.style.removeProperty("--swell");
    return;
  }
  const values = children.map((tick) => {
    const distance = (tick.offsetTop + tick.offsetHeight / 2 - y) / 26;
    return Math.exp(-distance * distance).toFixed(3);
  });
  children.forEach((tick, i) => {
    if (tick.style.getPropertyValue("--swell") !== values[i])
      tick.style.setProperty("--swell", values[i]);
  });
}

/**
 * Turn index on the left edge of the chat. Hover/focus previews a turn,
 * click jumps there (the search palette's `jump`), and the card's branch
 * button resumes a new chat right after that turn's response.
 */
export function TurnRail({
  sessionId,
  records,
  thread,
}: {
  sessionId: string;
  records: readonly TranscriptRecord[];
  thread: RefObject<HTMLElement | null>;
}) {
  const t = useT();
  const turns = useMemo(() => collectTurns(records), [records]);
  const [branching, setBranching] = useState(false);
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState<{ index: number; top: number }>();
  const ticksRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const pointer = useRef<number | "card">(undefined);
  const previewVisible = !!open && !!turns[open.index] && turns.length >= 2;

  const openTick = useCallback((tick: HTMLElement) => {
    const nav = tick.closest(".turn-rail");
    if (!nav) return;
    const box = tick.getBoundingClientRect();
    const index = Number(tick.dataset.index);
    const top = box.top - nav.getBoundingClientRect().top + box.height / 2;
    setOpen((old) =>
      old?.index === index && old.top === top ? old : { index, top },
    );
  }, []);
  const follow = useCallback(() => {
    const ticks = ticksRef.current;
    if (!ticks) return;
    markEdges(ticks);
    const first = ticks.firstElementChild;
    if (
      typeof pointer.current !== "number" ||
      !(first instanceof HTMLElement) ||
      !first.offsetHeight
    )
      return;
    const y =
      ticks.scrollTop +
      Math.max(
        0,
        Math.min(
          ticks.clientHeight - 1,
          pointer.current - ticks.getBoundingClientRect().top,
        ),
      );
    const tick = ticks.children[Math.floor(y / first.offsetHeight)];
    if (tick instanceof HTMLElement) {
      swell(ticks, y);
      openTick(tick);
    }
  }, [openTick]);

  useEffect(() => {
    if (!previewVisible) return;
    const close = () => {
      pointer.current = undefined;
      swell(ticksRef.current);
      setOpen(undefined);
    };
    // Only retain a pointer-opened preview; the extra space is never a hit target.
    const track = (event: PointerEvent) => {
      if (pointer.current === undefined) return;
      if (
        event.target instanceof Element &&
        event.target.closest(".turn-rail-card") ===
          cardRef.current?.firstElementChild
      ) {
        pointer.current = "card";
        return;
      }
      for (const element of [ticksRef.current, cardRef.current]) {
        if (!element) continue;
        const r = element.getBoundingClientRect();
        if (
          event.clientX >= r.left - 24 &&
          event.clientX <= r.right + 24 &&
          event.clientY >= r.top - 24 &&
          event.clientY <= r.bottom + 24
        ) {
          if (element === ticksRef.current) {
            if (event.target instanceof Node && element.contains(event.target))
              return; // handled by the rail
            pointer.current = event.clientY;
            follow();
          } else pointer.current = "card";
          return;
        }
      }
      close();
    };
    document.addEventListener("pointermove", track, true);
    document.documentElement.addEventListener("pointerleave", close);
    window.addEventListener("blur", close);
    return () => {
      document.removeEventListener("pointermove", track, true);
      document.documentElement.removeEventListener("pointerleave", close);
      window.removeEventListener("blur", close);
    };
  }, [previewVisible, follow]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: Re-measure when the tick list changes.
  useLayoutEffect(() => {
    if (ticksRef.current) markEdges(ticksRef.current);
  }, [turns]);
  // While idle, keep the reading position inside the window.
  useEffect(() => {
    const ticks = ticksRef.current;
    const tick = ticks?.children[active] as HTMLElement | undefined;
    if (!ticks || !tick || pointer.current !== undefined) return;
    ticks.scrollTo({
      top: tick.offsetTop - (ticks.clientHeight - tick.offsetHeight) / 2,
      behavior: "smooth",
    });
  }, [active]);

  // shortcut: reads rendered rows, so turns outside VirtualTurns' window (>200 rows) never become active; derive from VirtualTurns keys if that matters.
  useEffect(() => {
    const element = thread.current;
    if (!element || turns.length < 2) return;
    const indices = new Map(turns.map((turn, i) => [turn.id, i]));
    const update = () => {
      const line =
        element.getBoundingClientRect().top + element.clientHeight / 3;
      let current = 0;
      for (const row of element.querySelectorAll<HTMLElement>(
        "[data-record-id]",
      )) {
        const index = indices.get(row.dataset.recordId ?? "");
        if (
          index !== undefined &&
          index > current &&
          row.getBoundingClientRect().top <= line
        )
          current = index;
      }
      setActive(current);
    };
    update();
    element.addEventListener("scroll", update, { passive: true });
    return () => element.removeEventListener("scroll", update);
  }, [thread, turns]);

  if (turns.length < 2) return null;
  const jump = (turn: Turn) => {
    if (turn.entryId)
      useStore.setState({
        jump: { sessionId, entryId: turn.entryId, nonce: Date.now() },
      });
  };
  const shown = open && turns[open.index];
  const branch = (entryId: string) => {
    if (branching) return;
    setBranching(true);
    void forkChat(sessionId, entryId)
      .catch(showError)
      .finally(() => setBranching(false));
  };
  return (
    <nav
      className="turn-rail"
      data-preview={previewVisible || undefined}
      aria-label={t["Conversation turns"]}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          setOpen(undefined);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") setOpen(undefined);
      }}
    >
      <div
        ref={ticksRef}
        className="turn-rail-ticks"
        onPointerMove={(event) => {
          pointer.current = event.clientY;
          follow();
        }}
        onScroll={follow}
      >
        {turns.map((turn, index) => {
          const focus = (event: { currentTarget: HTMLElement }) => {
            const tick = event.currentTarget;
            tick.scrollIntoView({ block: "nearest" });
            openTick(tick);
            swell(tick.parentElement, tick.offsetTop + tick.offsetHeight / 2);
          };
          return (
            <button
              key={turn.id}
              type="button"
              className="turn-rail-tick"
              data-index={index}
              style={{ "--i": index } as React.CSSProperties}
              data-active={index === active || undefined}
              data-open={index === open?.index || undefined}
              aria-current={index === active ? "location" : undefined}
              aria-label={turn.title || t.Image}
              onFocus={focus}
              onClick={() => jump(turn)}
            />
          );
        })}
      </div>
      {shown && open && (
        <div
          ref={cardRef}
          className="turn-rail-card-anchor"
          style={{ top: open.top }}
        >
          <div className="turn-rail-card ui-tooltip" data-side="right">
            <div key={shown.id} className="ui-tooltip-swap">
              <div className="turn-rail-card-head">
                <button
                  type="button"
                  className="turn-rail-card-title"
                  onClick={() => jump(shown)}
                >
                  {shown.title || t.Image}
                </button>
                <button
                  type="button"
                  className="turn-rail-branch"
                  aria-label={t["Branch into new chat"]}
                  disabled={!shown.branchEntryId || branching}
                  onClick={() =>
                    shown.branchEntryId && branch(shown.branchEntryId)
                  }
                >
                  <Split size={14} aria-hidden="true" />
                </button>
              </div>
              {shown.preview && (
                <p className="turn-rail-card-preview">{shown.preview}</p>
              )}
              <span className="turn-rail-card-meta">
                {open.index + 1} / {turns.length}
              </span>
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}
