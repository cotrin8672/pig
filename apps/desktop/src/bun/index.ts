import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import Electrobun, {
  BrowserView,
  BrowserWindow,
  Updater,
  Utils,
} from "electrobun/bun";
import {
  type Appearance,
  providers,
  type RPCSchema,
} from "../shared/rpc-schema";
import {
  applyBackdrop,
  loadAppearance,
  saveAppearance,
  setNativeEnvironment,
  validateAppearance,
} from "./appearance";
import {
  cancelAllLogins,
  cancelLogin,
  resolveLogin,
  startLogin,
} from "./login";
import {
  listInstalled,
  packageOperation,
  packagePreviews,
  searchPackages,
} from "./packages";
import {
  abortSession,
  availableModels,
  closeSession,
  disposeSessions,
  getSession,
  listSessions,
  openSession,
  promptSession,
  reloadPackageSessions,
  runtime,
} from "./pi-service";

const projectFile = join(Utils.paths.userData, "projects.json");
let projects: string[] = [];
let corruptProjects = false;
try {
  const saved: unknown = JSON.parse(await readFile(projectFile, "utf8"));
  if (!Array.isArray(saved) || !saved.every((p) => typeof p === "string"))
    throw new Error("Invalid projects file");
  projects = saved;
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
    corruptProjects = true;
    console.error("Cannot load projects:", error);
  }
}
let projectsQueue = Promise.resolve();
function saveProjects(change: (current: string[]) => string[]) {
  const save = projectsQueue.then(async () => {
    await mkdir(Utils.paths.userData, { recursive: true });
    if (corruptProjects) {
      await rename(projectFile, `${projectFile}.corrupt-${Date.now()}`);
      corruptProjects = false;
    }
    const next = change(projects);
    const temporary = `${projectFile}.${crypto.randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(next));
    await rename(temporary, projectFile);
    projects = next;
    return projects;
  });
  projectsQueue = save.then(
    () => {},
    () => {},
  );
  return save;
}
async function validateProject(cwd: string) {
  if (!projects.includes(cwd) || !(await stat(cwd)).isDirectory())
    throw new Error("Choose an existing registered project directory.");
}
const appearanceFile = join(Utils.paths.userData, "appearance.json");
let appearance: Appearance = await loadAppearance(appearanceFile);
let appearanceQueue = Promise.resolve();
function updateAppearance(value: unknown) {
  appearanceQueue = appearanceQueue
    .then(async () => {
      const next = validateAppearance(value);
      // Apply before persisting so a rejected backdrop is never saved or re-applied at startup.
      applyBackdrop(window.ptr, next);
      await saveAppearance(appearanceFile, next);
      appearance = next;
      rpc.send.appearance(appearance);
    })
    .catch((error) => {
      rpc.send.appearanceError({ message: String(error) });
      // Let the UI revert to what is actually applied.
      rpc.send.appearance(appearance);
    });
}
const report = (error: unknown) => {
  console.error(error);
  rpc.send.error({ message: String(error) });
};
const rpc = BrowserView.defineRPC<RPCSchema>({
  maxRequestTime: 600_000,
  handlers: {
    requests: {
      searchPackages: (input) => searchPackages(input),
      packagePreviews: (input) => packagePreviews(input),
      listInstalled: () => listInstalled(),
      appearance: () => appearance,
      bootstrap: async () => ({
        projects,
        providers: providers.map((p) => ({
          ...p,
          loggedIn: runtime.isUsingOAuth(p.id),
        })),
        models: (await availableModels()).map(({ provider, id, name }) => ({
          provider,
          id,
          name,
        })),
      }),
      listSessions: async ({ cwd }) => {
        await validateProject(cwd);
        return listSessions(cwd);
      },
      openSession: async (input) => {
        await validateProject(input.cwd);
        if (
          input.path &&
          !(await SessionManager.list(input.cwd)).some(
            (s) => s.path === input.path,
          )
        )
          throw new Error("Session does not belong to this project.");
        return openSession(input, (sessionId, event) =>
          rpc.send.agentEvent({ sessionId, event }),
        );
      },
      removeProject: ({ cwd }) =>
        saveProjects((current) => current.filter((p) => p !== cwd)),
      logout: async ({ provider }) => {
        if (!providers.some((p) => p.id === provider))
          throw new Error("Invalid provider.");
        await runtime.logout(provider);
      },
      setModel: async ({ sessionId, provider, id }) => {
        const model = (await availableModels()).find(
          (m) => m.provider === provider && m.id === id,
        );
        if (!model)
          throw new Error("Model unavailable. Sign in to its provider first.");
        await getSession(sessionId).setModel(model);
        return { provider: model.provider, id: model.id, name: model.name };
      },
    },
    messages: {
      installPackage: (input) => {
        void packageOperation(
          "install",
          input,
          (event) => rpc.send.packageOp(event),
          (items) => rpc.send.installed(items),
          () => reloadPackageSessions((message) => rpc.send.error({ message })),
          (message) => rpc.send.error({ message }),
        ).catch(console.error);
      },
      uninstallPackage: (input) => {
        void packageOperation(
          "uninstall",
          input,
          (event) => rpc.send.packageOp(event),
          (items) => rpc.send.installed(items),
          () => reloadPackageSessions((message) => rpc.send.error({ message })),
          (message) => rpc.send.error({ message }),
        ).catch(console.error);
      },
      updatePackage: (input) => {
        void packageOperation(
          "update",
          input,
          (event) => rpc.send.packageOp(event),
          (items) => rpc.send.installed(items),
          () => reloadPackageSessions((message) => rpc.send.error({ message })),
          (message) => rpc.send.error({ message }),
        ).catch(console.error);
      },
      setAppearance: (value) => updateAppearance(value),
      windowControl: (value) => {
        // RPC input is untrusted even though the webview has a typed sender.
        if (!value || typeof value !== "object") return;
        switch (value.action) {
          case "minimize":
            window.minimize();
            break;
          case "toggleMaximize":
            if (window.isMaximized()) window.unmaximize();
            else window.maximize();
            break;
          case "close":
            window.close();
            break;
        }
      },
      // Windows folder dialogs can stall inside RPC requests (Electrobun #156).
      addProject: () => {
        void (async () => {
          const folder = (
            await Utils.openFileDialog({
              canChooseFiles: false,
              canChooseDirectory: true,
              allowsMultipleSelection: false,
            })
          ).join(",");
          if (folder)
            await saveProjects((current) =>
              current.includes(folder) ? current : [...current, folder],
            );
          rpc.send.projects(projects);
        })().catch(report);
      },
      startLogin: ({ provider, loginId }) => {
        void startLogin(
          provider,
          loginId,
          (frame) => rpc.send.loginFrame(frame),
          (url) => {
            Utils.openExternal(url);
          },
        ).catch(report);
      },
      resolveLogin: ({ loginId, value }) => resolveLogin(loginId, value),
      cancelLogin: ({ loginId }) => cancelLogin(loginId),
      openExternal: ({ url }) => {
        if (/^https?:\/\//i.test(url)) Utils.openExternal(url);
      },
      prompt: ({ sessionId, text }) => {
        void (async () => {
          const session = getSession(sessionId);
          if (
            !session.model ||
            !providers.some((p) => p.id === session.model?.provider)
          )
            throw new Error("Choose an OpenAI Codex or Anthropic model first.");
          await promptSession(sessionId, text);
        })().catch(report);
      },
      abort: ({ sessionId }) => {
        void Promise.resolve()
          .then(() => abortSession(sessionId))
          .catch(report);
      },
      closeSession: ({ sessionId }) => {
        void closeSession(sessionId).catch(report);
      },
    },
  },
});
let url = "views://mainview/index.html";
if ((await Updater.localInfo.channel()) === "dev") {
  setNativeEnvironment(
    "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
    `${process.env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS ?? ""} --remote-debugging-port=9229`.trim(),
  );
  try {
    await fetch("http://localhost:5173", {
      method: "HEAD",
      signal: AbortSignal.timeout(1000),
    });
    url = "http://localhost:5173";
  } catch {
    console.log("[view] Using bundled webview");
  }
}
// Set both Win32 and Bun environments before WebView2 creates its first controller.
setNativeEnvironment("WEBVIEW2_DEFAULT_BACKGROUND_COLOR", "00000000");
const window = new BrowserWindow({
  transparent: true,
  title: "piris",
  titleBarStyle: "hiddenInset",
  url,
  rpc,
  frame: { x: 100, y: 80, width: 1280, height: 840 },
});
// Apply once the webview exists: before that Electrobun's container child is missing and
// would keep its opaque class brush (verified: a startup-only apply leaves the client gray).
let backdropApplied = false;
window.on("resize", () => {
  rpc.send.windowState({ maximized: window.isMaximized() });
});
window.webview.on("dom-ready", () => {
  if (backdropApplied) return;
  backdropApplied = true;
  rpc.send.windowState({ maximized: window.isMaximized() });
  try {
    applyBackdrop(window.ptr, appearance);
  } catch (error) {
    console.error("Cannot apply backdrop:", error);
    rpc.send.appearanceError({ message: String(error) });
  }
});
console.log("[window] piris started");
// WebView2 can start with a stale composition size on Windows/DPI-scaled screens.
setTimeout(() => {
  const f = window.getFrame();
  window.setFrame(f.x, f.y, f.width + 2, f.height + 2);
  setTimeout(() => window.setFrame(f.x, f.y, f.width, f.height), 100);
}, 300);
function dispose() {
  cancelAllLogins();
  disposeSessions();
}
window.on("close", dispose);
Electrobun.events.on("before-quit", dispose);
process.on("exit", dispose);
