export interface RenderWorker {
  postMessage(value: unknown): void;
  addEventListener(
    type: string,
    listener: (event: Event & { data?: unknown }) => void,
  ): void;
  terminate(): void;
}
type Job<I, O> = {
  id: number;
  input: I;
  resolve: (value: O | undefined) => void;
  reject: (error: Error) => void;
  cleanup: () => void;
};

/** One in-flight task per worker. Superseded/unmounted jobs are removed before
 * cloning their input to the worker; cancellation never drops another consumer. */
export function createRenderWorkerQueue<I, O>(
  create: () => Promise<RenderWorker>,
) {
  let worker: Promise<RenderWorker> | undefined;
  let nextId = 0;
  let running: number | undefined;
  let failed: Error | undefined;
  const jobs = new Map<number, Job<I, O>>();
  const counts = { posted: 0, completed: 0, cancelled: 0 };
  const fail = (error: Error) => {
    failed = error;
    for (const job of jobs.values()) {
      job.cleanup();
      job.reject(error);
    }
    jobs.clear();
    running = undefined;
    void worker?.then(
      (value) => value.terminate(),
      () => {},
    );
  };
  const getWorker = () => {
    worker ??= create().then((value) => {
      value.addEventListener("message", (event) => {
        const reply = event.data as { id: number; result?: O; error?: string };
        if (!reply || typeof reply.id !== "number" || reply.id !== running)
          return;
        running = undefined;
        const job = jobs.get(reply.id);
        jobs.delete(reply.id);
        if (job) {
          job.cleanup();
          counts.completed++;
          if (reply.error) job.reject(new Error(reply.error));
          else job.resolve(reply.result);
        }
        pump();
      });
      value.addEventListener("error", (event) => {
        event.preventDefault();
        fail(new Error("Render worker failed"));
      });
      value.addEventListener("messageerror", () =>
        fail(new Error("Render worker reply could not be decoded")),
      );
      return value;
    });
    return worker;
  };
  const pump = () => {
    if (failed || running !== undefined || !jobs.size) return;
    // Reserve the head before asynchronous worker startup; no duplicate sends.
    const job = jobs.values().next().value as Job<I, O>;
    running = job.id;
    void getWorker()
      .then((value) => {
        if (!jobs.has(job.id)) {
          running = undefined;
          pump();
          return;
        }
        counts.posted++;
        value.postMessage({ id: job.id, input: job.input });
      })
      .catch((error) =>
        fail(error instanceof Error ? error : new Error(String(error))),
      );
  };
  return {
    run(input: I, signal?: AbortSignal): Promise<O | undefined> {
      if (signal?.aborted) return Promise.resolve(undefined);
      if (failed) return Promise.reject(failed);
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        const cancel = () => {
          const job = jobs.get(id);
          if (!job) return;
          jobs.delete(id);
          job.cleanup();
          counts.cancelled++;
          resolve(undefined);
          // An already running computation finishes in the worker, not the UI.
          if (running !== id) pump();
        };
        jobs.set(id, {
          id,
          input,
          resolve,
          reject,
          cleanup: () => signal?.removeEventListener("abort", cancel),
        });
        signal?.addEventListener("abort", cancel, { once: true });
        pump();
      });
    },
    stats: () => ({
      ...counts,
      pending: jobs.size,
      running: running !== undefined,
      failed: !!failed,
    }),
  };
}
