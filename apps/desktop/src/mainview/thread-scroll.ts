export function isThreadAtBottom(
  element: Pick<HTMLElement, "scrollHeight" | "clientHeight" | "scrollTop">,
) {
  // scrollTop can be fractional while the height measurements are rounded.
  return element.scrollHeight - element.clientHeight - element.scrollTop <= 1;
}

export type ThreadView = {
  follow: boolean;
  top: number;
  work: Record<string, boolean>;
  details: Record<string, boolean>;
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
    view = { follow: true, top: 0, work: {}, details: {} };
    views.set(key, view);
  }
  return view;
}

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
