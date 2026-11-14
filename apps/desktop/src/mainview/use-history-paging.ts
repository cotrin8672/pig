import {
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { ChatSnapshot } from "./chat-snapshot";
import { addressKey, prependHistory, sameAddress } from "./chat-snapshot";
import { rpc } from "./rpc";
import { showError, useStore } from "./store";

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
  const key = cursorKey(snapshot);

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
        useStore.setState((state) => {
          const saved = state.snapshots[current.info.id];
          if (!saved || !sameAddress(saved.address, owner)) return {};
          const next = prependHistory(saved, page, before);
          if (next === saved) return {};
          latest.current.preparePrepend();
          return { snapshots: { ...state.snapshots, [current.info.id]: next } };
        });
      } catch (cause) {
        if (!isCurrent()) return;
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
          rootMargin: `${Math.max(320, root.clientHeight)}px 0px 0px 0px`,
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
    loadEarlier,
    loadingHistory: !!key && pending === key,
    historyError: error?.key === key ? error?.message : undefined,
  };
}
