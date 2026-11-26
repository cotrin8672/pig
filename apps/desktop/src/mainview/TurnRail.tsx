import { Split } from "lucide-react";
import {
  type RefObject,
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
  for (const tick of ticks.children as HTMLCollectionOf<HTMLElement>) {
    if (y === undefined) {
      tick.style.removeProperty("--swell");
      continue;
    }
    const distance = (tick.offsetTop + tick.offsetHeight / 2 - y) / 26;
    tick.style.setProperty(
      "--swell",
      Math.exp(-distance * distance).toFixed(3),
    );
  }
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
  const pointer = useRef<{ x: number; y: number }>(undefined);

  const openTick = (tick: HTMLElement) => {
    const nav = tick.closest(".turn-rail");
    if (!nav) return;
    const box = tick.getBoundingClientRect();
    setOpen({
      index: Number(tick.dataset.index),
      top: box.top - nav.getBoundingClientRect().top + box.height / 2,
    });
  };
  // Pointer moves and wheel scrolls both re-aim the swell and the card at
  // whatever tick is now under the pointer.
  const follow = () => {
    const ticks = ticksRef.current;
    if (!ticks) return;
    markEdges(ticks);
    if (!pointer.current) return;
    const { x, y } = pointer.current;
    swell(ticks, y - ticks.getBoundingClientRect().top + ticks.scrollTop);
    const tick = document
      .elementFromPoint(x, y)
      ?.closest<HTMLElement>(".turn-rail-tick");
    if (tick) openTick(tick);
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: Re-measure when the tick list changes.
  useLayoutEffect(() => {
    if (ticksRef.current) markEdges(ticksRef.current);
  }, [turns]);
  // While idle, keep the reading position inside the window.
  useEffect(() => {
    const ticks = ticksRef.current;
    const tick = ticks?.children[active] as HTMLElement | undefined;
    if (!ticks || !tick || pointer.current) return;
    ticks.scrollTo({
      top: tick.offsetTop - (ticks.clientHeight - tick.offsetHeight) / 2,
      behavior: "smooth",
    });
  }, [active]);

  // shortcut: reads rendered rows, so turns outside VirtualTurns' window (>200 rows) never become active; derive from VirtualTurns keys if that matters.
  useEffect(() => {
    const element = thread.current;
    if (!element) return;
    const update = () => {
      const line =
        element.getBoundingClientRect().top + element.clientHeight / 3;
      let current = 0;
      turns.forEach((turn, index) => {
        const row = element.querySelector(
          `[data-record-id="${CSS.escape(turn.id)}"]`,
        );
        if (row && row.getBoundingClientRect().top <= line) current = index;
      });
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
      aria-label={t["Conversation turns"]}
      onMouseLeave={() => {
        pointer.current = undefined;
        setOpen(undefined);
        swell(ticksRef.current);
      }}
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
          pointer.current = { x: event.clientX, y: event.clientY };
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
        <div className="turn-rail-card-anchor" style={{ top: open.top }}>
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
