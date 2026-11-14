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
  input: I | undefined;
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
      job.input = undefined;
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
    let started: Promise<RenderWorker>;
    try {
      started = getWorker();
    } catch (error) {
      fail(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    void started
      .then((value) => {
        if (!jobs.has(job.id)) {
          running = undefined;
          pump();
          return;
        }
        counts.posted++;
        value.postMessage({ id: job.id, input: job.input });
        // postMessage has synchronously cloned the payload into the worker.
        // Keeping the source here cannot help completion or cancellation.
        job.input = undefined;
      })
      .catch((error) =>
        fail(error instanceof Error ? error : new Error(String(error))),
      );
  };
  // Keep cancellation closures outside run(): otherwise their lexical scope can
  // retain run's input parameter even after job.input has been released.
  const enqueue = (job: Job<I, O>, signal?: AbortSignal) => {
    const id = job.id;
    const cancel = () => {
      const current = jobs.get(id);
      if (!current) return;
      jobs.delete(id);
      current.input = undefined;
      current.cleanup();
      counts.cancelled++;
      current.resolve(undefined);
      // An already running computation finishes in the worker, not the UI.
      if (running !== id) pump();
    };
    job.cleanup = () => signal?.removeEventListener("abort", cancel);
    jobs.set(id, job);
    signal?.addEventListener("abort", cancel, { once: true });
    pump();
  };
  return {
    run(input: I, signal?: AbortSignal): Promise<O | undefined> {
      if (signal?.aborted) return Promise.resolve(undefined);
      if (failed) return Promise.reject(failed);
      const { promise, resolve, reject } = Promise.withResolvers<
        O | undefined
      >();
      enqueue(
        { id: ++nextId, input, resolve, reject, cleanup: () => {} },
        signal,
      );
      return promise;
    },
    stats: () => ({
      ...counts,
      pending: jobs.size,
      running: running !== undefined,
      failed: !!failed,
    }),
  };
}
