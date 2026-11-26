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
  let failures = 0;
  let generation = 0;
  const jobs = new Map<number, Job<I, O>>();
  const urgent = new Set<number>();
  const counts = { posted: 0, completed: 0, cancelled: 0 };
  const fail = (error: Error, owner = generation) => {
    if (owner !== generation) return;
    generation++;
    failures++;
    failed = error;
    for (const job of jobs.values()) {
      job.input = undefined;
      job.cleanup();
      job.reject(error);
    }
    jobs.clear();
    urgent.clear();
    running = undefined;
    const stopped = worker;
    worker = undefined;
    void stopped?.then(
      (value) => value.terminate(),
      () => {},
    );
  };
  const getWorker = () => {
    if (worker) return worker;
    const owner = ++generation;
    worker = create().then((value) => {
      value.addEventListener("message", (event) => {
        if (owner !== generation) return;
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
          else {
            failures = 0;
            job.resolve(reply.result);
          }
        }
        pump();
      });
      value.addEventListener("error", (event) => {
        event.preventDefault();
        fail(new Error("Render worker failed"), owner);
      });
      value.addEventListener("messageerror", () =>
        fail(new Error("Render worker reply could not be decoded"), owner),
      );
      return value;
    });
    return worker;
  };
  const pump = () => {
    if (failed || running !== undefined || !jobs.size) return;
    // Reserve the head before asynchronous worker startup; no duplicate sends.
    const first = urgent.values().next();
    const job = first.done
      ? (jobs.values().next().value as Job<I, O>)
      : (jobs.get(first.value) as Job<I, O>);
    urgent.delete(job.id);
    running = job.id;
    let started: Promise<RenderWorker>;
    try {
      started = getWorker();
    } catch (error) {
      fail(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    const owner = generation;
    void started
      .then((value) => {
        if (owner !== generation) return;
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
        fail(error instanceof Error ? error : new Error(String(error)), owner),
      );
  };
  // Keep cancellation closures outside run(): otherwise their lexical scope can
  // retain run's input parameter even after job.input has been released.
  const enqueue = (job: Job<I, O>, signal?: AbortSignal, priority = false) => {
    const id = job.id;
    const cancel = () => {
      const current = jobs.get(id);
      if (!current) return;
      jobs.delete(id);
      urgent.delete(id);
      current.input = undefined;
      current.cleanup();
      counts.cancelled++;
      current.resolve(undefined);
      // An already running computation finishes in the worker, not the UI.
      if (running !== id) pump();
    };
    job.cleanup = () => signal?.removeEventListener("abort", cancel);
    jobs.set(id, job);
    if (priority) urgent.add(id);
    signal?.addEventListener("abort", cancel, { once: true });
    pump();
  };
  return {
    run(
      input: I,
      signal?: AbortSignal,
      priority = false,
    ): Promise<O | undefined> {
      if (signal?.aborted) return Promise.resolve(undefined);
      // A later request may replace a crashed worker. Never replay a posted job
      // (its input is released), or loop forever when the host blocks workers.
      if (failed && failures >= 3) return Promise.reject(failed);
      failed = undefined;
      const { promise, resolve, reject } = Promise.withResolvers<
        O | undefined
      >();
      enqueue(
        { id: ++nextId, input, resolve, reject, cleanup: () => {} },
        signal,
        priority,
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
