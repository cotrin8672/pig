type Entry<T> = {
  confirmed: T;
  desired: T;
  revision: number;
  task: Promise<void>;
};

/** Serialize writes, but never make the caller wait to display its latest intent. */
export class OptimisticValue<T> {
  private entries = new Map<string, Entry<T>>();
  constructor(private report: (error: unknown) => void) {}
  change(
    key: string,
    current: T,
    desired: T,
    publish: (value: T) => void,
    write: () => Promise<T>,
  ) {
    const entry = this.entries.get(key) ?? {
      confirmed: current,
      desired,
      revision: 0,
      task: Promise.resolve(),
    };
    entry.desired = desired;
    const revision = ++entry.revision;
    this.entries.set(key, entry);
    publish(desired);
    entry.task = entry.task.then(async () => {
      try {
        entry.confirmed = await write();
      } catch (error) {
        this.report(error);
      } finally {
        if (entry.revision === revision) {
          this.entries.delete(key);
          publish(entry.confirmed);
        }
      }
    });
    return entry.task;
  }
  async flush(key: string) {
    while (this.entries.has(key)) await this.entries.get(key)?.task;
  }
  value(key: string) {
    return this.entries.get(key)?.desired;
  }
}
