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

async function devTools(endpoint: string, timeoutMs = 10_000) {
  if (
    !/^ws:\/\/127\.0\.0\.1:\d{1,5}\/devtools\/browser\/[a-z0-9-]+$/i.test(
      endpoint,
    )
  )
    throw new Error("Invalid fixture browser endpoint");
  const socket = new WebSocket(endpoint);
  try {
    await new Promise<void>((resolve, reject) => {
      const fail = () =>
        finish(new Error("Could not connect to fixture browser"));
      const finish = (error?: Error) => {
        clearTimeout(timeout);
        socket.removeEventListener("open", opened);
        socket.removeEventListener("error", fail);
        socket.removeEventListener("close", fail);
        if (error) reject(error);
        else resolve();
      };
      const opened = () => finish();
      const timeout = setTimeout(fail, timeoutMs);
      socket.addEventListener("open", opened, { once: true });
      socket.addEventListener("error", fail, { once: true });
      socket.addEventListener("close", fail, { once: true });
    });
  } catch (error) {
    socket.close();
    throw error;
  }
  let id = 0;
  const command = <T>(
    method: string,
    params = {},
    sessionId?: string,
  ): Promise<T> =>
    new Promise((resolve, reject) => {
      if (socket.readyState !== WebSocket.OPEN) {
        reject(new Error("Fixture browser closed"));
        return;
      }
      const request = ++id;
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error(`Fixture command timed out: ${method}`));
      }, timeoutMs);
      const cleanup = () => {
        clearTimeout(timeout);
        socket.removeEventListener("message", receive);
        socket.removeEventListener("close", closed);
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
      socket.addEventListener("message", receive);
      socket.addEventListener("close", closed, { once: true });
      try {
        socket.send(JSON.stringify({ id: request, method, params, sessionId }));
      } catch (error) {
        cleanup();
        reject(error);
      }
    });
  return { socket, command };
}

function launchBrowser(binary: string, args: string[]) {
  const child = Bun.spawn([binary, ...args], {
    stdout: "ignore",
    stderr: "ignore",
  });
  return {
    running: () => child.exitCode === null && child.signalCode === null,
    async close() {
      child.kill("SIGKILL");
      await child.exited;
    },
  };
}

/** The suite owns one private Edge/Chromium instance, not the user's browser. */
export async function startFixtureBrowser(binary: string, directory: string) {
  const profile = join(directory, "profile");
  const args = [
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
    "--disable-backgrounding-occluded-windows",
    "--force-device-scale-factor=1",
    "--window-size=600,600",
    "about:blank",
  ];
  const child =
    process.platform === "win32"
      ? (await import("./ui-browser-windows")).launchBrowserInJob(binary, args)
      : launchBrowser(binary, args);
  let endpoint = "";
  try {
    const deadline = performance.now() + 10_000;
    while (performance.now() < deadline && child.running()) {
      const address = await readFile(
        join(profile, "DevToolsActivePort"),
        "utf8",
      ).catch((error: NodeJS.ErrnoException) => {
        if (!["ENOENT", "EBUSY", "EPERM"].includes(error.code ?? ""))
          throw error;
        return "";
      });
      const [port, path] = address.split(/\r?\n/);
      if (
        /^\d{1,5}$/.test(port) &&
        /^\/devtools\/browser\/[a-z0-9-]+$/i.test(path ?? "")
      ) {
        endpoint = `ws://127.0.0.1:${port}${path}`;
        break;
      }
      await Bun.sleep(25);
    }
    if (!endpoint)
      throw new Error("Fixture browser did not open its debugging port");
  } catch (error) {
    await child.close();
    throw error;
  }
  return {
    endpoint,
    async close() {
      try {
        if (!child.running()) return;
        const { socket, command } = await devTools(endpoint, 1_000);
        try {
          // The websocket may disconnect before acknowledging Browser.close.
          await command("Browser.close").catch(() => {});
        } finally {
          socket.close();
        }
        const deadline = performance.now() + 3_000;
        while (performance.now() < deadline && child.running())
          await Bun.sleep(25);
      } catch {
        // If DevTools is gone or hung, close the job below instead.
      } finally {
        await child.close();
      }
    },
  };
}

/** Each fixture has a fresh context even when sharing the suite's browser. */
export async function fixtureBrowser(
  binary: string,
  directory: string,
  url: string,
  viewport = { width: 600, height: 600 },
) {
  const shared = process.env.PIG_UI_BROWSER_ENDPOINT;
  const standalone = shared
    ? undefined
    : await startFixtureBrowser(binary, directory);
  let tools: Awaited<ReturnType<typeof devTools>> | undefined;
  let contextId: string | undefined;
  const close = async () => {
    try {
      if (contextId && tools?.socket.readyState === WebSocket.OPEN) {
        const browserContextId = contextId;
        contextId = undefined;
        await tools.command("Target.disposeBrowserContext", {
          browserContextId,
        });
      }
    } finally {
      tools?.socket.close(); // Also disposes the context if setup/explicit disposal failed.
      await standalone?.close();
    }
  };
  try {
    const connection = await devTools(shared ?? standalone?.endpoint ?? "");
    tools = connection;
    const { socket, command: browserCommand } = connection;
    const { browserContextId } = await browserCommand<{
      browserContextId: string;
    }>("Target.createBrowserContext", { disposeOnDetach: true });
    contextId = browserContextId;
    const { targetId } = await browserCommand<{ targetId: string }>(
      "Target.createTarget",
      {
        url: "about:blank",
        browserContextId,
      },
    );
    const { sessionId } = await browserCommand<{ sessionId: string }>(
      "Target.attachToTarget",
      {
        targetId,
        flatten: true,
      },
    );
    const command = <T>(method: string, params = {}) =>
      browserCommand<T>(method, params, sessionId);
    // Avoid Edge's delayed automation infobar resizing the test viewport.
    await command("Emulation.setDeviceMetricsOverride", {
      ...viewport,
      deviceScaleFactor: 1,
      mobile: false,
    });
    // Windows CI often reports reduced motion; animation fixtures assert the
    // shipped timings, so pin the preference instead of inheriting it.
    await command("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value: "no-preference" }],
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
        message.sessionId === sessionId &&
        message.method === "Page.lifecycleEvent" &&
        message.params.name === "DOMContentLoaded"
      ) {
        loaded.add(message.params.loaderId);
        if (message.params.loaderId === loader) ready?.();
      }
    };
    socket.addEventListener("message", lifecycle);
    socket.addEventListener("close", navigationClosed);
    try {
      const navigation = await command<{
        loaderId?: string;
        errorText?: string;
      }>("Page.navigate", { url });
      if (navigation.errorText) throw new Error(navigation.errorText);
      loader = navigation.loaderId;
      if (loader && !loaded.has(loader)) {
        const timeout = setTimeout(
          () => rejectReady?.(new Error("Fixture navigation timed out")),
          20_000,
        );
        try {
          await new Promise<void>((resolve, reject) => {
            ready = resolve;
            rejectReady = reject;
            if (socket.readyState !== WebSocket.OPEN) navigationClosed();
          });
        } finally {
          clearTimeout(timeout);
        }
      }
    } finally {
      socket.removeEventListener("message", lifecycle);
      socket.removeEventListener("close", navigationClosed);
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
      close,
    };
  } catch (error) {
    await close().catch((cleanupError) => {
      throw new AggregateError(
        [error, cleanupError],
        "Fixture setup and cleanup failed",
      );
    });
    throw error;
  }
}
