import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";

/** Node's Windows-aware recursive removal handles closed Edge profiles that
 * Bun's rm can keep reporting as EBUSY. Cleanup errors still fail the test. */
export async function removeFixtureDirectory(directory: string) {
  if (process.platform !== "win32") {
    await rm(directory, { recursive: true, force: true });
    return;
  }
  const child = Bun.spawn(
    [
      "node",
      "-e",
      "require('node:fs/promises').rm(process.argv[1], {recursive:true,force:true,maxRetries:20,retryDelay:100}).catch(error=>{console.error(error);process.exitCode=1})",
      directory,
    ],
    { stdout: "ignore", stderr: "pipe" },
  );
  const [code, error] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
  ]);
  if (code !== 0) throw new Error(`Fixture cleanup failed: ${error}`);
}

/** Isolated Edge/Chromium fixture driver; never attaches to a user's browser profile. */
export async function fixtureBrowser(
  binary: string,
  directory: string,
  url: string,
  viewport = { width: 600, height: 600 },
) {
  const profile = join(directory, "profile");
  const child = Bun.spawn(
    [
      binary,
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--disable-background-mode",
      `--user-data-dir=${profile}`,
      "--remote-debugging-port=0",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      "--force-device-scale-factor=1",
      "--window-size=600,600",
      "about:blank",
    ],
    { stdout: "ignore", stderr: "pipe" },
  );
  const stderr = new Response(child.stderr).text();
  let socket: WebSocket | undefined;
  const kill = setTimeout(() => child.kill(), 40_000);
  try {
    let port = "";
    for (let i = 0; i < 400; i++) {
      try {
        const value = (
          await readFile(join(profile, "DevToolsActivePort"), "utf8")
        ).split(/\r?\n/)[0];
        if (/^\d+$/.test(value)) {
          port = value;
          break;
        }
      } catch {
        /* The profile may still be locked by browser startup. */
      }
      await Bun.sleep(25);
    }
    if (!port)
      throw new Error("Fixture browser did not open its debugging port");
    const target = (await (
      await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, {
        method: "PUT",
      })
    ).json()) as { webSocketDebuggerUrl: string };
    socket = new WebSocket(target.webSocketDebuggerUrl);
    const connected = socket;
    await new Promise<void>((resolve, reject) => {
      connected.addEventListener("open", () => resolve(), { once: true });
      connected.addEventListener("error", reject, { once: true });
    });
    let id = 0;
    const command = <T>(method: string, params = {}): Promise<T> =>
      new Promise((resolve, reject) => {
        const request = ++id;
        const timeout = setTimeout(() => {
          cleanup();
          reject(new Error(`Fixture command timed out: ${method}`));
        }, 10_000);
        const cleanup = () => {
          clearTimeout(timeout);
          connected.removeEventListener("message", receive);
          connected.removeEventListener("close", closed);
        };
        const closed = () => {
          cleanup();
          reject(new Error("Fixture browser closed"));
        };
        const receive = (event: MessageEvent) => {
          const message = JSON.parse(String(event.data));
          if (message.id !== request) return;
          cleanup();
          if (message.error) reject(new Error(message.error.message));
          else resolve(message.result);
        };
        connected.addEventListener("message", receive);
        connected.addEventListener("close", closed, { once: true });
        connected.send(JSON.stringify({ id: request, method, params }));
      });
    // Match the native transcript driver: pin layout before loading the page.
    // Edge's delayed automation infobar otherwise resizes the viewport during
    // geometry/animation assertions (and intermittently moves the whole page).
    await command("Emulation.setDeviceMetricsOverride", {
      ...viewport,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await command("Page.enable");
    await command("Page.setLifecycleEventsEnabled", { enabled: true });
    const loaded = new Set<string>();
    let loader: string | undefined,
      ready: (() => void) | undefined,
      rejectReady: ((error: Error) => void) | undefined;
    const navigationClosed = () =>
      rejectReady?.(new Error("Fixture browser closed during navigation"));
    const lifecycle = (event: MessageEvent) => {
      const message = JSON.parse(String(event.data));
      if (
        message.method === "Page.lifecycleEvent" &&
        message.params.name === "DOMContentLoaded"
      ) {
        loaded.add(message.params.loaderId);
        if (message.params.loaderId === loader) ready?.();
      }
    };
    connected.addEventListener("message", lifecycle);
    connected.addEventListener("close", navigationClosed);
    try {
      const navigation = await command<{
        loaderId?: string;
        errorText?: string;
      }>("Page.navigate", { url });
      if (navigation.errorText) throw new Error(navigation.errorText);
      loader = navigation.loaderId;
      if (loader && !loaded.has(loader))
        await new Promise<void>((resolve, reject) => {
          ready = resolve;
          rejectReady = reject;
          if (connected.readyState !== WebSocket.OPEN) navigationClosed();
        });
    } finally {
      connected.removeEventListener("message", lifecycle);
      connected.removeEventListener("close", navigationClosed);
    }
    // about:blank initially focuses browser chrome; activate the fixture's
    // content before tests exercise real DOM focus/capture and pane ownership.
    await command("Page.bringToFront");
    return {
      command,
      async evaluate<T>(expression: string): Promise<T> {
        const reply = await command<{
          result: { value: T };
          exceptionDetails?: unknown;
        }>("Runtime.evaluate", {
          expression,
          returnByValue: true,
          awaitPromise: true,
        });
        if (reply.exceptionDetails)
          throw new Error(JSON.stringify(reply.exceptionDetails));
        return reply.result.value;
      },
      async screenshot() {
        const reply = await command<{ data: string }>(
          "Page.captureScreenshot",
          { format: "png" },
        );
        return Buffer.from(reply.data, "base64");
      },
      async close() {
        await command("Browser.close").catch(() => {});
        connected.close();
        clearTimeout(kill);
        // Browser.close acknowledges before Windows releases the profile. Killing
        // the parent immediately can strand children with open profile handles.
        const shutdown = setTimeout(() => child.kill(), 3_000);
        try {
          await child.exited;
        } finally {
          clearTimeout(shutdown);
        }
        await stderr;
      },
    };
  } catch (error) {
    socket?.close();
    child.kill();
    clearTimeout(kill);
    throw error;
  }
}
