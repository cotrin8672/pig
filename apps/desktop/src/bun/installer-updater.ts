import type { AppUpdateState } from "../shared/app-update";
import type { DesktopPlatform } from "./desktop-platform";

export class InstallerUpdater {
  private state: AppUpdateState;
  private generation = 0;
  private installing = false;
  constructor(
    version: string,
    private native: NonNullable<DesktopPlatform["installerUpdater"]>,
    private nightly: () => boolean,
    private notify: (state: AppUpdateState) => void,
    private shutdown: (
      prepare: () => Promise<() => Promise<void>>,
    ) => Promise<boolean>,
  ) {
    this.state = { version, method: "installer", status: "idle" };
  }
  info() {
    return this.state;
  }
  private publish(
    status: AppUpdateState["status"],
    latest?: string,
    error?: string,
  ) {
    this.state = { ...this.state, status, latest, error };
    this.notify(this.state);
  }
  async check({ background = false } = {}) {
    const generation = ++this.generation;
    if (this.installing) return;
    this.publish("checking");
    try {
      const version = await this.native.check(this.nightly());
      if (generation === this.generation)
        this.publish(version ? "available" : "current", version ?? undefined);
    } catch (error) {
      if (generation === this.generation)
        this.publish(
          background ? "idle" : "error",
          undefined,
          background ? undefined : String(error),
        );
    }
  }
  async apply() {
    const version = this.state.latest;
    if (this.installing || !version) return;
    const generation = this.generation;
    const nightly = this.nightly();
    this.installing = true;
    this.publish("preparing");
    try {
      const accepted = await this.shutdown(async () => {
        await this.native.prepare(nightly, version);
        if (generation !== this.generation || nightly !== this.nightly())
          throw new Error("Update preference changed; check again.");
        return () => this.native.install();
      });
      if (!accepted) this.publish("available", version);
    } catch (error) {
      this.publish("error", undefined, String(error));
    } finally {
      this.installing = false;
      if (generation !== this.generation) await this.check();
    }
  }
}
