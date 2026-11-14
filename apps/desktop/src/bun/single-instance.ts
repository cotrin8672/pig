import { connect, createServer, type Server } from "node:net";
import { userInfo } from "node:os";

const OPEN_WINDOW = "open-window\n";

export function instancePipe(channel: string) {
  const user = userInfo().username.replace(/[^A-Za-z0-9_.-]/g, "_");
  return process.platform === "win32"
    ? `\\\\.\\pipe\\dev.pig.desktop-${channel}-${user}`
    : `/tmp/dev.pig.desktop-${channel}-${user}.sock`;
}

/**
 * Listen first, so two simultaneous launches cannot both become primary.
 * Returns the server when this process is the primary instance, or `undefined`
 * after a running primary accepted the request to open another window.
 */
export async function claimInstance(
  path: string,
  onOpenWindow: () => void,
): Promise<Server | undefined> {
  const server = createServer((socket) => {
    let received = "";
    socket.setEncoding("utf8");
    socket.setTimeout(5_000, () => socket.destroy());
    socket.on("error", () => {});
    socket.on("data", (chunk) => {
      received += chunk;
      if (received.length > OPEN_WINDOW.length) socket.destroy();
      else if (received === OPEN_WINDOW) {
        socket.end("ok\n");
        onOpenWindow();
      }
    });
  });
  const listened = await new Promise<boolean>((resolve, reject) => {
    server.once("error", (error: NodeJS.ErrnoException) =>
      error.code === "EADDRINUSE" ? resolve(false) : reject(error),
    );
    server.listen(path, () => resolve(true));
  });
  if (listened) {
    server.unref();
    return server;
  }
  await notifyPrimary(path);
  return undefined;
}

function notifyPrimary(path: string) {
  return new Promise<void>((resolve, reject) => {
    const socket = connect(path);
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("The running pig instance did not answer."));
    }, 5_000);
    let reply = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      reply += chunk;
    });
    socket.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    socket.on("close", () => {
      clearTimeout(timer);
      if (reply === "ok\n") resolve();
      else reject(new Error("The running pig instance refused the request."));
    });
    socket.write(OPEN_WINDOW);
  });
}
