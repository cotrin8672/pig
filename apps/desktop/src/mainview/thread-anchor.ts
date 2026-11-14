export type ThreadAnchor = {
  record?: HTMLElement;
  offset: number;
  top: number;
  height: number;
};

/** Capture at commit time, not request time: the reader can scroll during I/O. */
export function captureThreadAnchor(thread: HTMLElement): ThreadAnchor {
  const bounds = thread.getBoundingClientRect();
  const hit = thread.ownerDocument.elementFromPoint(
    bounds.left + bounds.width / 2,
    bounds.top + Math.min(32, bounds.height / 2),
  );
  let record = hit?.closest<HTMLElement>("[data-record-id]") ?? undefined;
  if (!record || !thread.contains(record))
    record = [...thread.querySelectorAll<HTMLElement>("[data-record-id]")].find(
      (row) => {
        const rect = row.getBoundingClientRect();
        return rect.bottom > bounds.top && rect.top < bounds.bottom;
      },
    );
  return {
    record,
    offset: record ? record.getBoundingClientRect().top - bounds.top : 0,
    top: thread.scrollTop,
    height: thread.scrollHeight,
  };
}

/** Ignore simultaneous growth below the reader and any anchoring already done by the browser. */
export function restoreThreadAnchor(thread: HTMLElement, anchor: ThreadAnchor) {
  if (anchor.record && thread.contains(anchor.record)) {
    const drift =
      anchor.record.getBoundingClientRect().top -
      thread.getBoundingClientRect().top -
      anchor.offset;
    if (Math.abs(drift) > 0.5) thread.scrollTop += drift;
  } else {
    thread.scrollTop = anchor.top + thread.scrollHeight - anchor.height;
  }
}
