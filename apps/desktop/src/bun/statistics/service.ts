import { existsSync } from "node:fs";
import {
  type StatisticsData,
  type StatisticsPeriod,
  validateStatisticsPeriod,
} from "../../shared/statistics";
import type {
  StatisticEvent,
  StatisticsCommand,
  StatisticsReply,
  StatisticsSink,
} from "./contracts";

export class StatisticsService implements StatisticsSink {
  private worker?: Worker;
  private queue: { event: StatisticEvent; bytes: number }[] = [];
  private bytes = 0;
  private dropped = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private readyTimer?: ReturnType<typeof setTimeout>;
  private ready = Promise.withResolvers<void>();
  private pending = new Map<
    number,
    {
      resolve: (data?: StatisticsData) => void;
      reject: () => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private nextId = 0;
  private flight?: Promise<void>;
  private closing = false;
  private disposal?: Promise<void>;
  private forgotten = new Set<string>();
  // A failed worker is replaced on the next use; repeated failures back off.
  private retryAt = 0;
  private retryDelay = 1000;
  error?: "storage" | "worker" | "overflow" | "metadata";

  constructor(
    private readonly file: string,
    private readonly workerUrl = (() => {
      const bundled = new URL("./statistics-worker.js", import.meta.url);
      return existsSync(bundled)
        ? bundled
        : new URL("./worker.ts", import.meta.url);
    })(),
  ) {}

  record(event: StatisticEvent) {
    if (this.closing || this.forgotten.has(event.owner)) return;
    this.start();
    if (this.error && this.error !== "overflow") {
      this.dropped++;
      return;
    }
    try {
      const bytes = Buffer.byteLength(JSON.stringify(event));
      if (
        (this.queue.length >= 4096 || this.bytes + bytes > 4 * 1024 * 1024) &&
        !["context_snapshot", "session_entry"].includes(event.type)
      ) {
        const index = this.queue.findIndex(({ event }) =>
          ["context_snapshot", "session_entry"].includes(event.type),
        );
        if (index >= 0) {
          this.bytes -= this.queue.splice(index, 1)[0].bytes;
          this.dropped++;
        }
      }
      if (
        bytes > 256 * 1024 ||
        this.queue.length >= 4096 ||
        this.bytes + bytes > 4 * 1024 * 1024
      ) {
        this.dropped++;
        if (!this.error)
          console.error("[statistics] collection queue overflow");
        this.error = "overflow";
        this.start();
        this.pump();
        return;
      }
      this.queue.push({ event, bytes });
      this.bytes += bytes;
      this.start();
      if (this.queue.length >= 100) this.pump();
      else if (!this.timer) {
        this.timer = setTimeout(() => {
          this.timer = undefined;
          this.pump();
        }, 1000);
      }
    } catch {
      this.fail("metadata");
    }
  }

  private start() {
    if (this.worker || this.closing) return;
    if (this.error && this.error !== "overflow") {
      if (Date.now() < this.retryAt) return;
      this.error = undefined;
      this.ready = Promise.withResolvers<void>();
    }
    let worker: Worker;
    try {
      worker = new Worker(this.workerUrl.href, { name: "pig-statistics" });
    } catch {
      this.fail("worker");
      return;
    }
    this.worker = worker;
    this.readyTimer = setTimeout(() => this.fail("worker"), 5000);
    worker.onmessage = ({ data }: MessageEvent<StatisticsReply>) => {
      if (this.worker !== worker) return;
      if (data.type === "ready") {
        clearTimeout(this.readyTimer);
        this.ready.resolve();
        this.pump();
      } else if (data.type === "error")
        this.fail(data.code === "storage" ? "storage" : "worker");
      else {
        const pending = this.pending.get(data.id);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(data.id);
        this.retryDelay = 1000;
        pending.resolve(data.type === "snapshot" ? data.data : undefined);
      }
    };
    worker.onerror = (event) => {
      event.preventDefault();
      if (this.worker === worker) this.fail("worker");
    };
    worker.postMessage({
      type: "open",
      file: this.file,
    } satisfies StatisticsCommand);
  }

  private fail(code: "storage" | "worker" | "metadata") {
    if (this.error === code && !this.worker) return;
    this.error = code;
    this.retryAt = Date.now() + this.retryDelay;
    this.retryDelay = Math.min(this.retryDelay * 2, 60_000);
    console.error(`[statistics] collection unavailable (${code})`);
    clearTimeout(this.timer);
    clearTimeout(this.readyTimer);
    this.dropped += this.queue.length;
    this.queue = [];
    this.bytes = 0;
    this.ready.resolve();
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject();
    }
    this.pending.clear();
    this.worker?.terminate();
    this.worker = undefined;
  }

  private command(
    command:
      | { type: "batch"; events: StatisticEvent[]; dropped: number }
      | { type: "forget"; owner: string }
      | { type: "flush" }
      | { type: "close" },
  ) {
    return new Promise<void>((resolve, reject) => {
      if (!this.worker || (this.error && this.error !== "overflow")) {
        reject(new Error("Statistics unavailable"));
        return;
      }
      const id = ++this.nextId;
      const timer = setTimeout(() => this.fail("worker"), 5000);
      this.pending.set(id, {
        resolve: () => resolve(),
        reject: () => reject(new Error("Statistics unavailable")),
        timer,
      });
      try {
        this.worker.postMessage({ ...command, id } satisfies StatisticsCommand);
      } catch {
        this.fail("worker");
      }
    });
  }

  async snapshot(period: StatisticsPeriod): Promise<StatisticsData> {
    validateStatisticsPeriod(period);
    if (this.closing) throw new Error("Statistics closed");
    this.start();
    await this.flush();
    if (!this.worker || (this.error && this.error !== "overflow"))
      throw new Error("Statistics unavailable");
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      const timer = setTimeout(() => this.fail("worker"), 10_000);
      this.pending.set(id, {
        timer,
        reject: () => reject(new Error("Statistics unavailable")),
        resolve: (data) =>
          data ? resolve(data) : reject(new Error("Statistics unavailable")),
      });
      try {
        this.worker?.postMessage({
          type: "query",
          period,
          id,
        } satisfies StatisticsCommand);
      } catch {
        this.fail("worker");
      }
    });
  }

  private pump() {
    if (
      !this.worker ||
      this.flight ||
      (!this.queue.length && !this.dropped) ||
      (this.error && this.error !== "overflow")
    )
      return;
    const batch = this.queue.splice(0, 100);
    this.bytes -= batch.reduce((total, item) => total + item.bytes, 0);
    const events = batch.map((item) => item.event);
    const dropped = this.dropped;
    this.dropped = 0;
    this.flight = this.ready.promise
      .then(() => this.command({ type: "batch", events, dropped }))
      .catch(() => {})
      .finally(() => {
        this.flight = undefined;
        this.pump();
      });
  }

  async flush() {
    if (!this.worker) return;
    clearTimeout(this.timer);
    this.timer = undefined;
    await this.ready.promise;
    this.pump();
    while (this.flight) await this.flight;
    await this.command({ type: "flush" });
  }

  async forget(owner: string) {
    if (this.closing) throw new Error("Statistics closed");
    this.forgotten.add(owner);
    this.queue = this.queue.filter(({ event }) => event.owner !== owner);
    this.bytes = this.queue.reduce((total, item) => total + item.bytes, 0);
    this.start();
    await this.ready.promise;
    // Commands already in flight are ordered before this deletion by the worker.
    await this.command({ type: "forget", owner });
  }

  close() {
    if (this.disposal) return this.disposal;
    this.closing = true;
    this.disposal = (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          (async () => {
            await this.flush();
            if (this.worker) await this.command({ type: "close" });
          })(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              this.fail("worker");
              reject(new Error("Statistics shutdown timed out"));
            }, 2000);
          }),
        ]);
      } catch {
        // Collection failure cannot prevent the app from quitting.
      } finally {
        clearTimeout(timer);
        clearTimeout(this.timer);
        clearTimeout(this.readyTimer);
        this.worker?.terminate();
      }
    })();
    return this.disposal;
  }
}
