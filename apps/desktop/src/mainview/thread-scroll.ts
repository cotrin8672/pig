export function isThreadAtBottom(
  element: Pick<HTMLElement, "scrollHeight" | "clientHeight" | "scrollTop">,
) {
  // scrollTop can be fractional while the height measurements are rounded.
  return element.scrollHeight - element.clientHeight - element.scrollTop <= 1;
}

export type ThreadAnchor = {
  id: string;
  order: number;
  offset: number;
  top: number;
};
export type ThreadView = {
  follow: boolean;
  start?: string;
  anchor?: ThreadAnchor;
  work: Record<string, boolean>;
  details: Record<string, boolean>;
  pages: Record<string, number>;
  textRanges: Record<string, number[]>;
};
const views = new Map<string, ThreadView>();

export function pruneThreadViews(
  snapshots: Record<string, { address: { hostId: string; sessionId: string } }>,
) {
  const retained = new Set(
    Object.values(snapshots).map(({ address }) =>
      JSON.stringify([address.hostId, address.sessionId]),
    ),
  );
  for (const key of views.keys()) if (!retained.has(key)) views.delete(key);
}

export function threadView(hostId: string, sessionId: string) {
  const key = JSON.stringify([hostId, sessionId]);
  let view = views.get(key);
  if (!view) {
    view = { follow: true, work: {}, details: {}, pages: {}, textRanges: {} };
    views.set(key, view);
  }
  return view;
}

export function recordWindow<T extends { id: string }>(
  records: readonly T[],
  first?: string,
) {
  const found =
    first === undefined
      ? -1
      : records.findIndex((record) => record.id === first);
  const start = found < 0 ? Math.max(0, records.length - 100) : found;
  return { start, end: Math.min(records.length, start + 100) };
}

export function captureThreadAnchor(
  thread: HTMLElement,
): ThreadAnchor | undefined {
  const top = thread.getBoundingClientRect().top;
  for (const record of thread.querySelectorAll<HTMLElement>(
    "[data-record-id]",
  )) {
    const rect = record.getBoundingClientRect();
    if (rect.bottom > top)
      return {
        id: record.dataset.recordId as string,
        order: Number(record.dataset.recordOrder),
        offset: rect.top - top,
        top: thread.scrollTop,
      };
  }
}

export function restoreThreadAnchor(thread: HTMLElement, anchor: ThreadAnchor) {
  const records = [...thread.querySelectorAll<HTMLElement>("[data-record-id]")];
  const exact = records.find((record) => record.dataset.recordId === anchor.id);
  const target =
    exact ??
    records.reduce<HTMLElement | undefined>(
      (nearest, record) =>
        !nearest ||
        Math.abs(Number(record.dataset.recordOrder) - anchor.order) <
          Math.abs(Number(nearest.dataset.recordOrder) - anchor.order)
          ? record
          : nearest,
      undefined,
    );
  const top = target
    ? thread.scrollTop +
      target.getBoundingClientRect().top -
      thread.getBoundingClientRect().top -
      (exact ? anchor.offset : 0)
    : anchor.top;
  if (Math.abs(thread.scrollTop - top) > 1) thread.scrollTop = top;
}

/** All resize, streaming and scroll work in a frame shares one layout pass. */
export function frameTask(
  work: () => void,
  request = (task: () => void) => requestAnimationFrame(task),
  cancel = (id: number) => cancelAnimationFrame(id),
) {
  let frame: number | undefined;
  return {
    schedule() {
      frame ??= request(() => {
        frame = undefined;
        work();
      });
    },
    dispose() {
      if (frame !== undefined) cancel(frame);
      frame = undefined;
    },
  };
}
