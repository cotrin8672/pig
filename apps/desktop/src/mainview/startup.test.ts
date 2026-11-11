import { beforeEach, expect, mock, test } from "bun:test";
import { fileURLToPath } from "node:url";
import type { Appearance, Bootstrap } from "../shared/rpc-schema";
import type { Settings } from "../shared/settings";

if (process.env.PIG_STARTUP_CHILD !== "1") {
  test("initialization and background refresh with the real RPC controller", async () => {
    const child = Bun.spawn(
      [process.execPath, "test", fileURLToPath(import.meta.url)],
      {
        env: { ...process.env, PIG_STARTUP_CHILD: "1" },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [code, out, error] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect(code, out + error).toBe(0);
  });
} else {
  const reads = {
    bootstrap: [] as ReturnType<typeof Promise.withResolvers<Bootstrap>>[],
    appearance: [] as ReturnType<typeof Promise.withResolvers<Appearance>>[],
    settings: [] as ReturnType<typeof Promise.withResolvers<Settings>>[],
  };
  let messages: {
    settings: (settings: Settings) => void;
    appearance: (appearance: Appearance) => void;
    installed: (installed: never[]) => void;
  };
  mock.module("electrobun/view", () => ({
    Electroview: class {
      constructor(readonly options: unknown) {}
      static defineRPC(config: { handlers: { messages: typeof messages } }) {
        messages = config.handlers.messages;
        return {
          send: { setSettings() {} },
          request: {
            bootstrap: () => {
              const read = Promise.withResolvers<Bootstrap>();
              reads.bootstrap.push(read);
              return read.promise;
            },
            appearance: () => {
              const read = Promise.withResolvers<Appearance>();
              reads.appearance.push(read);
              return read.promise;
            },
            settings: () => {
              const read = Promise.withResolvers<Settings>();
              reads.settings.push(read);
              return read.promise;
            },
          },
        };
      }
    },
  }));
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: { getItem: () => null },
  });
  const { refresh, updateSettings } = await import("./rpc");
  const { useStore } = await import("./store");
  const initial = useStore.getState();
  const settings: Settings = { ...initial.settings, language: "ja" };
  const appearance: Appearance = { ...initial.appearance, backdrop: "mica" };
  const bootstrap: Bootstrap = {
    ...initial.bootstrap,
    generalCwd: "",
    projects: [],
  };
  const tick = () => Bun.sleep(0);
  beforeEach(() => {
    reads.bootstrap.length =
      reads.appearance.length =
      reads.settings.length =
        0;
    useStore.setState(initial, true);
  });

  test("no initial language, connection or appearance is published until all reads complete", async () => {
    const seen: ReturnType<typeof useStore.getState>[] = [];
    const unsubscribe = useStore.subscribe((state) => seen.push(state));
    try {
      const pending = refresh();
      expect(reads.bootstrap).toHaveLength(1);
      expect(reads.settings).toHaveLength(1);
      expect(reads.appearance).toHaveLength(1);
      reads.bootstrap[0].resolve(bootstrap);
      reads.settings[0].resolve(settings);
      await tick();
      expect(useStore.getState().initialized).toBe(false);
      expect(seen).toEqual([]);
      reads.appearance[0].resolve(appearance);
      await pending;
      expect(seen).toHaveLength(1);
      expect(seen[0]).toMatchObject({
        initialized: true,
        settings,
        appearance,
        bootstrap,
      });
    } finally {
      unsubscribe();
    }
  });

  test("background refresh keeps the known screen and cannot undo newer settings or appearance", async () => {
    useStore.setState({ initialized: true, settings });
    const pending = refresh();
    const latestSettings = { ...settings, language: "en" as const };
    updateSettings({ language: "en" });
    messages.settings(latestSettings);
    const latestAppearance = { ...appearance, backdrop: "acrylic" as const };
    messages.appearance(latestAppearance);
    reads.bootstrap[0].resolve(bootstrap);
    reads.appearance[0].resolve(appearance);
    await tick();
    expect(useStore.getState().initialized).toBe(true);
    expect(useStore.getState().settings).toBe(latestSettings);
    reads.settings[0].resolve(settings);
    await pending;
    expect(useStore.getState().settings).toBe(latestSettings);
    expect(useStore.getState().appearance).toBe(latestAppearance);
  });

  test("failed initialization leaves no fake empty or disconnected state and can be retried", async () => {
    const pending = refresh();
    reads.bootstrap[0].reject(new Error("offline"));
    reads.appearance[0].resolve(appearance);
    reads.settings[0].resolve(settings);
    await expect(pending).rejects.toThrow("offline");
    expect(useStore.getState()).toBe(initial);
    const retry = refresh();
    reads.bootstrap[1].resolve(bootstrap);
    reads.appearance[1].resolve(appearance);
    reads.settings[1].resolve(settings);
    await retry;
    expect(useStore.getState()).toMatchObject({ initialized: true, settings });
  });

  test("an installed-package event distinguishes a confirmed empty list from an unread list", () => {
    expect(useStore.getState().installedLoaded).toBe(false);
    messages.installed([]);
    expect(useStore.getState()).toMatchObject({
      installed: [],
      installedLoaded: true,
    });
  });
}
