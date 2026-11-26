import {
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import type { ChatSnapshot } from "./chat-snapshot";
import { addressKey, prependHistory, sameAddress } from "./chat-snapshot";
import { rpc } from "./rpc";
import { isStaleSessionRead, showError, useStore } from "./store";

// Publish each page atomically, but don't mount a whole page of rich text in one frame.
const ROWS_PER_FRAME = 8;

function cursorKey(snapshot: ChatSnapshot) {
  const cursor = snapshot.transcript.history;
  return cursor?.before
    ? JSON.stringify([
        addressKey(snapshot.address),
        cursor.revision,
        cursor.before,
      ])
    : undefined;
}

/** Prefetch one page near the top; retain all loaded history and native scrolling. */
export function useHistoryPaging(
  snapshot: ChatSnapshot,
  thread: RefObject<HTMLElement | null>,
  preparePrepend: () => void,
) {
  const edge = useRef<HTMLDivElement>(null);
  const latest = useRef({ snapshot, preparePrepend });
  latest.current = { snapshot, preparePrepend };
  const generation = useRef(0);
  const flights = useRef(
    new Map<string, { generation: number; promise: Promise<void> }>(),
  );
  const failure = useRef<
    { key: string; message: string; retryAt: number } | undefined
  >(undefined);
  const [error, setError] = useState<typeof failure.current>();
  const [pending, setPending] = useState<string>();
  const [reveal, setReveal] = useState<{
    first: string;
    revision: string;
    hidden: number;
  }>();
  const hiddenRecords =
    reveal &&
    reveal.revision === snapshot.transcript.history?.revision &&
    reveal.first === snapshot.transcript.records[0]?.id
      ? reveal.hidden
      : 0;
  const key = hiddenRecords ? undefined : cursorKey(snapshot);
  const scrollingUntil = useRef(0);
  const batchSize = useRef(ROWS_PER_FRAME);
  useLayoutEffect(() => {
    const root = thread.current;
    if (!root) return;
    const scrolling = () => {
      scrollingUntil.current = performance.now() + 120;
    };
    const events = ["wheel", "touchmove", "keydown"] as const;
    for (const event of events)
      root.addEventListener(event, scrolling, { passive: true });
    return () => {
      for (const event of events) root.removeEventListener(event, scrolling);
      scrollingUntil.current = 0;
    };
  }, [thread]);

  useLayoutEffect(() => {
    if (!hiddenRecords) return;
    let frame: number;
    const mountBatch = () => {
      const root = thread.current;
      // Let the gesture run uninterrupted unless the reader needs more runway.
      if (
        performance.now() < scrollingUntil.current &&
        root &&
        root.scrollTop > root.clientHeight
      ) {
        frame = requestAnimationFrame(mountBatch);
        return;
      }
      const start = performance.now();
      const count = batchSize.current;
      latest.current.preparePrepend();
      flushSync(() =>
        setReveal((batch) =>
          batch && batch.hidden > count
            ? { ...batch, hidden: batch.hidden - count }
            : undefined,
        ),
      );
      // Leave room for input and paint when a batch contains expensive turns.
      batchSize.current =
        performance.now() - start > 8
          ? Math.max(1, Math.floor(count / 2))
          : Math.min(ROWS_PER_FRAME, count + 1);
    };
    frame = requestAnimationFrame(mountBatch);
    return () => cancelAnimationFrame(frame);
  }, [hiddenRecords, thread]);

  useLayoutEffect(() => {
    generation.current++;
    return () => {
      generation.current++;
    };
  }, []);

  const loadEarlier = useCallback((): Promise<void> => {
    const current = latest.current.snapshot;
    const cursor = current.transcript.history;
    if (!key || key !== cursorKey(current) || !cursor?.before)
      return Promise.resolve();
    const saved = useStore.getState().snapshots[current.info.id];
    if (
      !saved ||
      !sameAddress(saved.address, current.address) ||
      cursorKey(saved) !== key
    )
      return Promise.resolve();
    const token = generation.current;
    const existing = flights.current.get(key);
    if (existing?.generation === token) return existing.promise;
    const { before, revision } = cursor;
    const owner = current.address;
    const isCurrent = () =>
      generation.current === token &&
      cursorKey(latest.current.snapshot) === key;
    failure.current = undefined;
    setError(undefined);
    setPending(key);
    const flight = { generation: token, promise: Promise.resolve() };
    flights.current.set(key, flight);
    flight.promise = (async () => {
      try {
        const page = await rpc.request.getSessionHistory({
          ...owner,
          revision,
          before,
        });
        if (!isCurrent()) return;
        const authoritative = useStore.getState().snapshots[current.info.id];
        if (
          !authoritative ||
          !sameAddress(authoritative.address, owner) ||
          cursorKey(authoritative) !== key
        )
          return;
        if (!page.history || page.history.revision !== revision)
          throw new Error(
            "History revision did not match the requested cursor",
          );
        if (page.history.before === before)
          throw new Error("History cursor did not advance");
        const next = prependHistory(authoritative, page, before);
        if (next === authoritative) return;
        flushSync(() => {
          latest.current.preparePrepend();
          if (page.records.length)
            setReveal({
              first: page.records[0].id,
              revision,
              hidden: page.records.length,
            });
          useStore.setState((state) => ({
            snapshots: { ...state.snapshots, [current.info.id]: next },
          }));
        });
      } catch (cause) {
        if (!isCurrent() || isStaleSessionRead(cause)) return;
        const failed = {
          key,
          message: String(cause),
          retryAt: performance.now() + 500,
        };
        failure.current = failed;
        setError(failed);
        showError(cause);
      } finally {
        if (flights.current.get(key) === flight) flights.current.delete(key);
        if (generation.current === token)
          setPending((active) => (active === key ? undefined : active));
      }
    })();
    return flight.promise;
  }, [key]);

  useEffect(() => {
    const root = thread.current;
    const sentinel = edge.current;
    if (!key || !root || !sentinel) return;
    let disposed = false;
    let nearTop = false;
    let observedHeight: number | undefined;
    let observer: IntersectionObserver;
    const request = () => {
      if (
        !disposed &&
        nearTop &&
        root.clientHeight > 0 &&
        failure.current?.key !== key
      )
        void loadEarlier();
    };
    const observe = () => {
      if (disposed) return;
      const height = root.clientHeight;
      if (height === observedHeight) return;
      observedHeight = height;
      observer?.disconnect();
      observer = new IntersectionObserver(
        (entries) => {
          if (disposed) return;
          nearTop = entries.some((entry) => entry.isIntersecting);
          if (!nearTop && failure.current?.key === key) {
            failure.current = undefined;
            setError(undefined);
          }
          request();
        },
        {
          root,
          rootMargin: `${Math.max(320, 3 * height)}px 0px 0px 0px`,
        },
      );
      observer.observe(sentinel);
    };
    observe();
    const resize = new ResizeObserver(observe);
    resize.observe(root);
    const retry = () => {
      if (failure.current?.key === key) {
        failure.current = undefined;
        setError(undefined);
        request();
      }
    };
    const retryOnIntent = (event: Event) => {
      if (event instanceof WheelEvent && event.deltaY >= 0) return;
      if (
        event instanceof KeyboardEvent &&
        !["ArrowUp", "PageUp", "Home"].includes(event.key)
      )
        return;
      const failed = failure.current;
      if (nearTop && failed?.key === key && performance.now() >= failed.retryAt)
        retry();
    };
    root.addEventListener("wheel", retryOnIntent, { passive: true });
    root.addEventListener("keydown", retryOnIntent);
    root.addEventListener("touchstart", retryOnIntent, { passive: true });
    window.addEventListener("focus", retry);
    window.addEventListener("online", retry);
    return () => {
      disposed = true;
      observer.disconnect();
      resize.disconnect();
      root.removeEventListener("wheel", retryOnIntent);
      root.removeEventListener("keydown", retryOnIntent);
      root.removeEventListener("touchstart", retryOnIntent);
      window.removeEventListener("focus", retry);
      window.removeEventListener("online", retry);
    };
  }, [key, loadEarlier, thread]);

  return {
    edge,
    hiddenRecords,
    loadEarlier,
    loadingHistory: !!key && pending === key,
    historyError: error?.key === key ? error?.message : undefined,
  };
}
