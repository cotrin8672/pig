export const STREAM_TEXT_INTERVAL = 100;

/** Sample changing text, but never delay completion or let an old timer replace it. */
export function createTextSampler(
  publish: (text: string) => void,
  schedule = (task: () => void) => setTimeout(task, STREAM_TEXT_INTERVAL),
  cancel = (timer: ReturnType<typeof setTimeout>) => clearTimeout(timer),
) {
  let pending: ReturnType<typeof setTimeout> | undefined;
  let latest = "";
  return {
    update(text: string, streaming: boolean) {
      latest = text;
      if (!streaming) {
        if (pending !== undefined) cancel(pending);
        pending = undefined;
        publish(text);
      } else if (pending === undefined) {
        pending = schedule(() => {
          pending = undefined;
          publish(latest);
        });
      }
    },
    dispose() {
      if (pending !== undefined) cancel(pending);
      pending = undefined;
    },
  };
}
