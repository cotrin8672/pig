import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import Electrobun, {
  BrowserView,
  BrowserWindow,
  Updater,
  Utils,
} from "electrobun/bun";
import { dictionary } from "../shared/i18n";
import { sanitizeOverride } from "../shared/model-overrides";
import { isModelEnabled } from "../shared/models";
import { knownProject, withoutProject } from "../shared/projects";
import type {
  Appearance,
  Notice,
  RPCSchema,
  SessionTarget,
} from "../shared/rpc-schema";
import { sessionIdFromLink } from "../shared/session-links";
import { patchSettings } from "../shared/settings";
import {
  applyBackdrop,
  loadAppearance,
  saveAppearance,
  setNativeEnvironment,
  validateAppearance,
} from "./appearance";
import {
  desktopConfigDir,
  generalCwd,
  prepareDesktopConfig,
} from "./desktop-config";
import { DesktopStateStore } from "./desktop-state";
import { copyImage, initImageMenu, saveImage, showImageMenu } from "./images";
import {
  cancelAllLogins,
  cancelLogin,
  logoutProvider,
  resolveLogin,
  startLogin,
} from "./login";
import { ModelPreferences } from "./model-preferences";
import {
  readModelOverrides,
  writeDefaultEffort,
  writeModelOverride,
} from "./model-settings";
import { createCompletionTracker } from "./notifications";
import {
  abortSession,
  applyModelSettings,
  availableModels,
  closeSession,
  deleteSession,
  disposeSessions,
  forkSession,
  listProviders,
  listSessions,
  modelErrors,
  modelInfo,
  openSession,
  promptSession,
  renameSession,
  rewindSession,
  runtime,
  sessionCwd,
  setSessionEffort,
  setSessionModel,
  utilityModels,
} from "./pi-service";
import { validateSessionScope } from "./session-scope";
import { loadSettings, saveSettings } from "./settings";
import { synchronizeClientArea } from "./window-layout";

await prepareDesktopConfig(Utils.paths.userData);
const desktopState = new DesktopStateStore(
  join(desktopConfigDir, "desktop.json"),
  (state) => rpc.send.desktopState(state),
);
await desktopState.load();
const modelPreferences = new ModelPreferences(
  join(desktopConfigDir, "disabled-models.json"),
);
await modelPreferences.load();
const projectFile = join(desktopConfigDir, "projects.json");
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
    await mkdir(desktopConfigDir, { recursive: true });
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
async function validateScope(cwd: string) {
  await validateSessionScope(cwd, projects, generalCwd);
}
async function resolveSession(input: SessionTarget) {
  if (
    !input ||
    typeof input.cwd !== "string" ||
    typeof input.id !== "string" ||
    !input.id ||
    input.id.length > 128
  )
    throw new Error("Invalid chat reference.");
  await validateScope(input.cwd);
  const info = (await listSessions(input.cwd)).find(
    (session) => session.id === input.id,
  );
  if (!info) throw new Error("Chat not found. Refresh the session list.");
  return info;
}
let windowFocused = true;
function openManagedSession(input: { cwd: string; id?: string }) {
  const completion = createCompletionTracker();
  return openSession(
    input,
    (sessionId, event, contextUsage) => {
      rpc.send.agentEvent({ sessionId, event, contextUsage });
      const outcome = completion(event);
      if (event.transcript.running)
        void desktopState.clearCompletion(sessionId).catch(report);
      if (!outcome) return;
      void desktopState.completeSession(sessionId, outcome).catch(report);
      const t = dictionary(settings.language);
      const notice: Notice = {
        message:
          outcome === "error"
            ? (event.failure ?? t["Agent failed"])
            : t["Agent finished"],
        level: outcome,
        session: { id: sessionId, cwd: input.cwd },
      };
      rpc.send.notification(notice);
      if (!windowFocused || window.isMinimized()) {
        try {
          Utils.showNotification({ title: "pig", body: notice.message });
        } catch (error) {
          console.error("Cannot show desktop notification:", error);
        }
      }
    },
    modelPreferences.disabled,
  );
}
const settingsFile = join(desktopConfigDir, "settings.json");
let settings = await loadSettings(settingsFile);
let settingsQueue = Promise.resolve();
const appearanceFile = join(desktopConfigDir, "appearance.json");
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
initImageMenu(report);
const rpc = BrowserView.defineRPC<RPCSchema>({
  maxRequestTime: 600_000,
  handlers: {
    requests: {
      prompt: async ({ sessionId, text, requestId, images }) => {
        await validateScope(await sessionCwd(sessionId));
        return promptSession(sessionId, text, requestId, images);
      },
      copyImage: ({ src }) => copyImage(src),
      saveImage: ({ src }) => saveImage(src),
      appearance: () => appearance,
      settings: () => settings,
      bootstrap: async () => {
        for (const message of modelErrors.splice(0)) report(message);
        const [providers, models, utilities, modelOverrides] =
          await Promise.all([
            listProviders(),
            availableModels(),
            utilityModels(),
            readModelOverrides().catch((error) => {
              report(error);
              return {};
            }),
          ]);
        await desktopState.settled();
        return {
          generalCwd,
          projects,
          disabledModels: modelPreferences.disabled,
          modelOverrides,
          desktop: desktopState.value,
          providers,
          ...utilities,
          models: models.map(modelInfo),
        };
      },
      listSessions: async ({ cwd }) => {
        await validateScope(cwd);
        return listSessions(cwd);
      },
      markSessionRead: async (input) => {
        const info = await resolveSession(input);
        return desktopState.markSessionRead(info.id, input.completionId);
      },
      renameSession: async (input) =>
        renameSession(await resolveSession(input), input.name),
      setSessionState: async (input) => {
        const info = await resolveSession(input);
        return desktopState.setSession(info.id, input);
      },
      deleteSession: async (input) => {
        const info = await resolveSession(input);
        await deleteSession(info);
        try {
          await desktopState.forgetSession(info.id);
        } catch (error) {
          report(
            `Chat deleted, but desktop metadata cleanup failed: ${String(error)}`,
          );
        }
        return desktopState.value;
      },
      setUiPreferences: async (input) => {
        await desktopState.setUiPreferences(input);
      },
      openSessionLink: async ({ url }) => {
        const id = typeof url === "string" ? sessionIdFromLink(url) : undefined;
        if (!id) throw new Error("Invalid chat link.");
        for (const cwd of new Set([generalCwd, ...projects])) {
          try {
            await validateScope(cwd);
          } catch {
            continue;
          }
          const info = (await listSessions(cwd)).find(
            (session) => session.id === id,
          );
          if (info) return openManagedSession({ cwd, id });
        }
        throw new Error(
          "Chat not found in registered projects or general chats.",
        );
      },
      openSession: async (input) => {
        await validateScope(input.cwd);
        if (input.id) {
          const info = await resolveSession({ cwd: input.cwd, id: input.id });
          return openManagedSession({
            cwd: input.cwd,
            id: info.id,
          });
        }
        return openManagedSession(input);
      },
      rewindSession: async ({ sessionId, timestamp }) => {
        await validateScope(await sessionCwd(sessionId));
        return openManagedSession(await rewindSession(sessionId, timestamp));
      },
      forkSession: async ({ sessionId, timestamp }) => {
        await validateScope(await sessionCwd(sessionId));
        return openManagedSession(await forkSession(sessionId, timestamp));
      },
      removeProject: (input) =>
        saveProjects((current) => withoutProject(current, input?.cwd)),
      setProjectState: (input) =>
        desktopState.setProject(knownProject(input?.cwd, projects), input),
      openProjectFolder: (input) =>
        Utils.openPath(knownProject(input?.cwd, projects)),
      logout: async ({ provider }) => {
        if (typeof provider !== "string" || !runtime.getProvider(provider))
          throw new Error("Invalid provider.");
        await logoutProvider(provider);
      },
      setModel: async ({ sessionId, provider, id }) => {
        await validateScope(await sessionCwd(sessionId));
        const model = (await availableModels()).find(
          (m) => m.provider === provider && m.id === id,
        );
        if (!model || !isModelEnabled(model, modelPreferences.disabled))
          throw new Error("Model unavailable or hidden.");
        return setSessionModel(sessionId, provider, id);
      },
      setModelEnabled: async ({ provider, id, enabled }) => {
        if (
          typeof enabled !== "boolean" ||
          !(await availableModels()).some(
            (m) => m.provider === provider && m.id === id,
          )
        )
          throw new Error("Invalid model preference.");
        return modelPreferences.setEnabled(provider, id, enabled);
      },
      setModelsEnabled: async ({ provider, ids, enabled }) => {
        if (
          typeof enabled !== "boolean" ||
          !Array.isArray(ids) ||
          !ids.length ||
          ids.length > 1000
        )
          throw new Error("Invalid model preferences.");
        const models = await availableModels();
        if (
          !ids.every(
            (id) =>
              typeof id === "string" &&
              models.some(
                (model) => model.provider === provider && model.id === id,
              ),
          )
        )
          throw new Error("Invalid model preferences.");
        return modelPreferences.setManyEnabled(provider, ids, enabled);
      },
      setModelOverride: async ({ provider, id, override }) => {
        if (
          typeof provider !== "string" ||
          typeof id !== "string" ||
          !runtime.getModel(provider, id)
        )
          throw new Error("Unknown model.");
        await writeModelOverride(provider, id, sanitizeOverride(override));
        await applyModelSettings();
      },
      setDefaultEffort: async ({ provider, id, effort }) => {
        const model =
          typeof provider === "string" && typeof id === "string"
            ? runtime.getModel(provider, id)
            : undefined;
        if (!model) throw new Error("Unknown model.");
        if (
          effort !== null &&
          !modelInfo(model).thinkingLevels?.includes(effort)
        )
          throw new Error("Unsupported reasoning effort.");
        await writeDefaultEffort(provider, id, effort);
        await applyModelSettings();
      },
      setEffort: async ({ sessionId, effort }) => {
        await validateScope(await sessionCwd(sessionId));
        return setSessionEffort(sessionId, effort);
      },
    },
    messages: {
      setSettings: (patch) => {
        settingsQueue = settingsQueue
          .then(async () => {
            const next = patchSettings(settings, patch);
            await saveSettings(settingsFile, next);
            settings = next;
            rpc.send.settings(settings);
          })
          .catch((error) => {
            report(error);
            rpc.send.settings(settings);
          });
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
      startLogin: ({ provider, method, loginId }) => {
        void startLogin(
          provider,
          method,
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
      imageMenu: ({ src }) => {
        const t = dictionary(settings.language);
        showImageMenu(src, { copy: t["Copy image"], save: t["Save image"] });
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
  title: "pig",
  titleBarStyle: "hiddenInset",
  url,
  rpc,
  frame: { x: 100, y: 80, width: 1280, height: 840 },
});
window.on("focus", () => {
  windowFocused = true;
});
window.on("blur", () => {
  windowFocused = false;
});
// Apply once the webview exists: before that Electrobun's container child is missing and
// would keep its opaque class brush (verified: a startup-only apply leaves the client gray).
let backdropApplied = false;
window.on("resize", () => {
  if (backdropApplied) synchronizeClientArea(window.ptr, window.webview);
  rpc.send.windowState({ maximized: window.isMaximized() });
});
window.webview.on("dom-ready", () => {
  rpc.send.windowState({ maximized: window.isMaximized() });
  try {
    if (!backdropApplied) {
      applyBackdrop(window.ptr, appearance);
      backdropApplied = true;
    }
    // Controller creation is asynchronous and initially uses the outer frame.
    // Sync after it exists (also after navigation), never by nudging the HWND.
    synchronizeClientArea(window.ptr, window.webview);
  } catch (error) {
    console.error("Cannot apply backdrop:", error);
    rpc.send.appearanceError({ message: String(error) });
  }
});
console.log("[window] pig started");
function dispose() {
  cancelAllLogins();
  void disposeSessions().catch(console.error);
}
window.on("close", dispose);
Electrobun.events.on("before-quit", dispose);
process.on("exit", dispose);
