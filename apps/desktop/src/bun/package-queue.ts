// Session creation and package changes share one queue: resource discovery must not
// observe an installation halfway through. Rejections never poison the queue.
let queue = Promise.resolve();
export function withPackageLock<T>(work: () => Promise<T>): Promise<T> {
  const result = queue.then(work);
  queue = result.then(
    () => {},
    () => {},
  );
  return result;
}

// Capture before enqueueing: abort must cancel starts waiting behind a mutation.
export class PromptQueue {
  private generations = new WeakMap<object, number>();
  abort(session: object) {
    this.generations.set(session, (this.generations.get(session) ?? 0) + 1);
  }
  async start(session: object, work: () => Promise<void>) {
    const generation = this.generations.get(session) ?? 0;
    const result = await withPackageLock(async () => {
      if ((this.generations.get(session) ?? 0) !== generation) return;
      return { completion: work() };
    });
    await result?.completion;
  }
}
