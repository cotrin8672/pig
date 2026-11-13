import {
  type ProviderUsage,
  USAGE_REFRESH_COOLDOWN_MS,
  type UsageData,
} from "../../shared/provider-usage";
import { UsageError, type UsageTarget } from "./contracts";

type State = {
  target: UsageTarget;
  entry: ProviderUsage;
  next: number;
  failures: number;
};
/** One app-wide poller. No Provider imports, SDK dependency, UI timers or credential ownership. */
export class UsageService {
  private states = new Map<string, State>();
  private active = false;
  private disposed = false;
  private pending?: Promise<void>;
  private timer?: ReturnType<typeof setInterval>;
  private controller?: AbortController;
  constructor(
    private readonly targets: (signal: AbortSignal) => Promise<UsageTarget[]>,
    private readonly publish: (entries: ProviderUsage[]) => void,
    private readonly now = Date.now,
  ) {}
  snapshot() {
    return [...this.states.values()].map((state) => state.entry);
  }
  setActive(active: boolean) {
    if (this.disposed) return;
    this.active = active;
    if (active && !this.timer) {
      this.timer = setInterval(() => {
        void this.refresh();
      }, 30_000);
      this.timer.unref?.();
      void this.refresh();
    } else if (!active) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }
  refresh(force = false): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (this.pending) return this.pending;
    const controller = new AbortController();
    this.controller = controller;
    this.pending = this.run(force, controller.signal)
      .catch(() => {
        // Discovery/IPC failures are best effort too; never leak raw SDK errors.
      })
      .finally(() => {
        this.pending = undefined;
      });
    return this.pending;
  }
  private emit() {
    if (!this.disposed) this.publish(this.snapshot());
  }
  private async run(force: boolean, signal: AbortSignal) {
    const targets = await this.targets(signal);
    if (this.disposed || signal.aborted) return;
    const states = new Map<string, State>();
    for (const target of targets) {
      const prior = this.states.get(target.key);
      const same = prior?.target.revision === target.revision;
      states.set(
        target.key,
        same && prior
          ? {
              ...prior,
              target,
              entry: { ...prior.entry, label: target.label },
            }
          : {
              target,
              next: 0,
              failures: 0,
              entry: {
                key: target.key,
                provider: target.provider,
                label: target.label,
                accountId: target.accountId,
                source: target.source,
                status: "loading",
              },
            },
      );
    }
    this.states = states;
    this.emit();
    const work = [...states.values()].filter((state) => {
      // Auth/permission errors retry after a credential revision or an explicit update, not every poll.
      if (
        !force &&
        (state.entry.problem === "auth" || state.entry.problem === "permission")
      )
        return false;
      if (state.entry.retryAt && state.entry.retryAt > this.now()) return false;
      return (
        state.next <= this.now() ||
        (force &&
          state.next -
            (state.target.intervalMs ?? 120_000) +
            USAGE_REFRESH_COOLDOWN_MS <=
            this.now())
      );
    });
    let index = 0;
    await Promise.all(
      Array.from({ length: Math.min(3, work.length) }, async () => {
        while (index < work.length) {
          const state = work[index++];
          if (signal.aborted || this.disposed) return;
          try {
            const before = state.entry;
            const data = await state.target.read(signal);
            if (
              this.disposed ||
              signal.aborted ||
              this.states.get(state.target.key) !== state
            )
              continue;
            state.failures = 0;
            state.next = this.now() + (state.target.intervalMs ?? 120_000);
            if (state.entry !== before && state.entry.source === "response")
              continue;
            state.entry = {
              ...state.entry,
              source: state.target.source,
              status: "ready",
              data,
              observedAt: this.now(),
              problem: undefined,
              retryAt: undefined,
            };
          } catch (error) {
            if (
              this.disposed ||
              signal.aborted ||
              this.states.get(state.target.key) !== state
            )
              continue;
            const problem =
              error instanceof UsageError ? error : new UsageError("network");
            state.failures++;
            const retryAt = Math.max(
              problem.retryAt ?? 0,
              this.now() +
                Math.min(
                  30 * 60_000,
                  60_000 * 2 ** Math.min(state.failures - 1, 5),
                ),
            );
            state.next = retryAt;
            // Retain last success, including its ORIGINAL observedAt.
            state.entry = {
              ...state.entry,
              status: "error",
              problem: problem.code,
              retryAt,
            };
          }
          this.emit();
        }
      }),
    );
  }
  observe(key: string, data: UsageData, revision: string) {
    const state = this.states.get(key);
    if (
      !state ||
      state.target.revision !== revision ||
      !data.windows.length ||
      this.disposed
    )
      return;
    const windows = new Map(state.entry.data?.windows.map((w) => [w.id, w]));
    for (const window of data.windows) windows.set(window.id, window);
    state.entry = {
      ...state.entry,
      status: "ready",
      source: "response",
      observedAt: this.now(),
      problem: undefined,
      data: {
        ...state.entry.data,
        windows: [...windows.values()],
        balances: state.entry.data?.balances ?? [],
      },
    };
    this.emit();
  }
  invalidate(provider: string) {
    this.controller?.abort();
    for (const [key, state] of this.states)
      if (state.target.provider === provider) this.states.delete(key);
    this.emit();
    void (this.pending ?? Promise.resolve()).then(() => {
      if (this.active) void this.refresh();
    });
  }
  dispose() {
    this.disposed = true;
    this.active = false;
    clearInterval(this.timer);
    this.controller?.abort();
    this.states.clear();
  }
}
