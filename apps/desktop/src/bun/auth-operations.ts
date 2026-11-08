/** Serialize complete flows, not just their final credential writes. */
export class AuthOperations {
  private queues = new Map<string, Promise<unknown>>();
  private logins = new Map<string, Set<AbortController>>();
  private enqueue<T>(provider: string, fn: () => Promise<T>): Promise<T> {
    const run = (this.queues.get(provider) ?? Promise.resolve())
      .catch(() => {})
      .then(fn);
    this.queues.set(provider, run);
    void run
      .finally(() => {
        if (this.queues.get(provider) === run) this.queues.delete(provider);
      })
      .catch(() => {});
    return run;
  }
  login<T>(
    provider: string,
    controller: AbortController,
    fn: () => Promise<T>,
  ) {
    const pending = this.logins.get(provider) ?? new Set<AbortController>();
    this.logins.set(provider, pending);
    pending.add(controller);
    return this.enqueue(provider, async () => {
      try {
        controller.signal.throwIfAborted();
        return await fn();
      } finally {
        pending.delete(controller);
        if (!pending.size) this.logins.delete(provider);
      }
    });
  }
  logout(provider: string, fn: () => Promise<void>) {
    for (const controller of this.logins.get(provider) ?? [])
      controller.abort();
    return this.enqueue(provider, fn);
  }
}
export const authOperations = new AuthOperations();
