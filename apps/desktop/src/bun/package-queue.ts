// Resource discovery and package changes share one queue: discovery must not
// observe an installation halfway through. Never hold this lock while requesting reloads.
let queue = Promise.resolve();
export function withPackageLock<T>(work: () => Promise<T>): Promise<T> {
  const result = queue.then(work);
  queue = result.then(
    () => {},
    () => {},
  );
  return result;
}

// A burst of installs needs one reload, not one reload per package. Changes made
// during an active reload require another pass so no session keeps stale resources.
export function coalescePackageReload(reload: () => Promise<string[]>) {
  let revision = 0;
  let pending: Promise<string[]> | undefined;
  return () => {
    revision++;
    pending ??= Promise.resolve()
      .then(async () => {
        for (;;) {
          const current = revision;
          let failures: string[];
          try {
            failures = await reload();
          } catch (error) {
            failures = [String(error)];
          }
          if (current === revision) return failures;
        }
      })
      .finally(() => {
        pending = undefined;
      });
    return pending;
  };
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
