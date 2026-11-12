import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import Electrobun, {
  BrowserView,
  BrowserWindow,
  Updater,
  Utils,
} from "electrobun/bun";
import { accountSourceKey } from "../shared/account-models";
import { dictionary } from "../shared/i18n";
import { sanitizeOverride } from "../shared/model-overrides";
import { isModelEnabled } from "../shared/models";
import { knownProject, withoutProject } from "../shared/projects";
import type { Notice, RPCSchema, SessionTarget } from "../shared/rpc-schema";
import type { OpenSessionParams } from "../shared/runtime-contract";
import { sessionIdFromLink } from "../shared/session-links";
import { patchSettings } from "../shared/settings";
import { AppUpdater } from "./app-update";
import {
  applyBackdrop,
  loadAppearance,
  saveAppearance,
  setNativeEnvironment,
  validateAppearance,
} from "./appearance";
import { attachmentPreview, storeFile } from "./attachments";
import { ChatRendererLoader } from "./chat-renderer-loader";
import { readDefaultModel, writeDefaultModel } from "./default-model";
import {
  desktopConfigDir,
  generalCwd,
  prepareDesktopConfig,
} from "./desktop-config";
import { DesktopStateStore } from "./desktop-state";
import { flushDraftsBeforeClose } from "./draft-close";
import { listFontFamilies } from "./fonts";
import { copyImage, initImageMenu, saveImage, showImageMenu } from "./images";
import {
  cancelAllLogins,
  cancelLogin,
  createProviderAccount,
  logoutProvider,
  removeProviderAccount,
  renameProviderAccount,
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
  listInstalled,
  packageOperation,
  packagePreviews,
  searchPackages,
} from "./packages";
import {
  importLegacyAuth,
  importLegacySessions,
  piDataReport,
} from "./pi-data";
import {
  abortSession,
  accountModels,
  applyModelSettings,
  availableModels,
  closeSession,
  configureSessionHost,
  deleteSession,
  disposeSessions,
  findSession,
  forkSession,
  listProviders,
  listSessions,
  modelErrors,
  modelInfo,
  openSession,
  promptSession,
  refreshModels,
  refreshProviderModels,
  refreshUserCatalog,
  renameSession,
  rewindSession,
  runtime,
  sessionHost,
  setDisabledModels,
  setSessionEffort,
  setSessionModel,
  utilityModels,
} from "./pi-service";
import { providerAccounts } from "./provider-accounts";
import { agentDir, agentDirSource } from "./runtime-profile";
import { validateSessionScope } from "./session-scope";
import { loadSettings, saveSettings } from "./settings";
import {
  packOpenState,
  packRuntimeEvent,
  packRuntimeState,
  packSnapshot,
  packTranscript,
} from "./transcript-wire";

await prepareDesktopConfig(Utils.paths.userData);
// Paths only (never values): GUI env can differ from the user's shell.
console.info(`Pi agent directory: ${agentDir} (${agentDirSource})`);
const chatRendererLoader = new ChatRendererLoader(
  join(desktopConfigDir, "chat-renderers.tsx"),
);
const desktopState = new DesktopStateStore(
  join(desktopConfigDir, "desktop.json"),
  (state) => rpc.send.desktopState(state),
);

const modelPreferences = new ModelPreferences(
  join(desktopConfigDir, "disabled-models.json"),
);
await Promise.all([desktopState.load(), modelPreferences.load()]);
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
  // One header check instead of scanning every chat in the project.
  try {
    return await findSession(input.cwd, input.id);
  } catch {
    throw new Error("Chat not found. Refresh the session list.");
  }
}
let windowFocused = true;
async function openManagedSession(input: OpenSessionParams) {
  return packSnapshot(await openSession(input));
}
const settingsFile = join(desktopConfigDir, "settings.json");
const appearanceFile = join(desktopConfigDir, "appearance.json");
let [settings, appearance] = await Promise.all([
  loadSettings(settingsFile),
  loadAppearance(appearanceFile),
]);
let settingsQueue = Promise.resolve();
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
async function reloadPackages() {
  const failures: string[] = [];
  await Promise.all([
    refreshUserCatalog().then(
      (diagnostics) => failures.push(...diagnostics),
      (error) => failures.push(String(error)),
    ),
    ...sessionHost
      .runtimeState()
      .sessions.filter((session) => session.phase === "ready")
      .map((session) =>
        sessionHost
          .reloadSession(session.address)
          .catch((error) => failures.push(String(error))),
      ),
  ]);
  return failures;
}
const rpc = BrowserView.defineRPC<RPCSchema>({
  maxRequestTime: 600_000,
  handlers: {
    requests: {
      getAppUpdate: () => appUpdater.info(),
      getPiData: () => piDataReport(),
      importLegacyAuth: async ({ file, providers }) => {
        if (
          typeof file !== "string" ||
          !Array.isArray(providers) ||
          !providers.every((id) => typeof id === "string")
        )
          throw new Error("Invalid import request.");
        const result = await importLegacyAuth(file, providers);
        if (result.copied)
          await refreshModels({ providers, allowNetwork: false });
        return result;
      },
      importLegacySessions: () => importLegacySessions(),
      getChatRendererBundle: () => chatRendererLoader.load(),
      searchPackages: (input) => searchPackages(input),
      packagePreviews: (input) => packagePreviews(input),
      listInstalled: () => listInstalled(),
      prompt: (input) => promptSession(input),
      getOpenState: (input) => packOpenState(sessionHost.getOpenState(input)),
      cancelOpen: (input) => sessionHost.cancelOpen(input),
      getSessionSnapshot: (input) =>
        packSnapshot(sessionHost.getSessionSnapshot(input)),
      getSessionHistory: async (input) =>
        packTranscript(await sessionHost.getSessionHistory(input)),
      listSlashCommands: (input) => sessionHost.listSlashCommands(input),
      completeSlashArguments: (input) =>
        sessionHost.completeSlashArguments(input),
      getPromptReceipt: (input) => sessionHost.getPromptReceipt(input),
      cancelPrompt: (input) => sessionHost.cancelPrompt(input),
      getRecovery: (input) => sessionHost.getRecovery(input),
      syncDraft: (input) => sessionHost.syncDraft(input),
      discardRecovery: (input) => sessionHost.discardRecovery(input),
      resolveExtensionUI: (input) => sessionHost.resolveExtensionUI(input),
      terminalCommand: (input) => sessionHost.terminalCommand(input),
      runtimeState: () => packRuntimeState(sessionHost.runtimeState()),
      heartbeatUI: (input) => sessionHost.heartbeatUI(input),
      abort: (input) => abortSession(input),
      closeSession: (input) => closeSession(input),
      reloadSession: (input) => sessionHost.reloadSession(input),
      invokeSessionAction: (input) => sessionHost.invokeSessionAction(input),
      reloadAdapterConfig: () => sessionHost.reloadAdapterConfig(),
      readClipboardImage: () => {
        const bytes = Utils.clipboardReadImage();
        if (!bytes?.length) return null;
        if (bytes.length > 3.375 * 1024 * 1024)
          throw new Error("Each image must be at most 4.5 MiB of base64 data.");
        return Buffer.from(bytes).toString("base64");
      },
      attachmentPreview: ({ path }) => attachmentPreview(path),
      copyImage: ({ src }) => copyImage(src),
      saveImage: ({ src }) => saveImage(src),
      storeAttachment: ({ name, data }) => storeFile(name, data),
      appearance: () => appearance,
      settings: () => settings,
      listFontFamilies,
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
        const accountCatalogs = Object.fromEntries([
          ...providers.map(
            (provider) =>
              [
                accountSourceKey(provider.id),
                models
                  .filter((model) => model.provider === provider.id)
                  .map(modelInfo),
              ] as const,
          ),
          ...(await Promise.all(
            providers.flatMap((provider) =>
              (provider.accounts ?? []).map(
                async (account) =>
                  [
                    accountSourceKey(provider.id, account.id),
                    account.configured
                      ? await accountModels(provider.id, account.id).catch(
                          (error) => {
                            report(error);
                            return [];
                          },
                        )
                      : [],
                  ] as const,
              ),
            ),
          )),
        ]);
        const allModels = [
          ...new Map(
            Object.values(accountCatalogs)
              .flat()
              .map((model) => [`${model.provider}/${model.id}`, model]),
          ).values(),
        ];
        await desktopState.settled();
        return {
          generalCwd,
          projects,
          disabledModels: modelPreferences.disabled,
          modelOverrides,
          desktop: desktopState.value,
          providers,
          ...utilities,
          models: allModels,
          accountCatalogs,
          defaultModel: (() => {
            try {
              return readDefaultModel();
            } catch (error) {
              report(error);
              return null;
            }
          })(),
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
          if (info)
            return openManagedSession({ cwd, id, openId: crypto.randomUUID() });
        }
        throw new Error(
          "Chat not found in registered projects or general chats.",
        );
      },
      openSession: async (input) => {
        await validateScope(input.cwd);
        // SessionHost validates persisted membership while resolving the file.
        return openManagedSession(input);
      },
      rewindSession: async (input) => packSnapshot(await rewindSession(input)),
      forkSession: async (input) => packSnapshot(await forkSession(input)),
      removeProject: (input) =>
        saveProjects((current) => withoutProject(current, input?.cwd)),
      setProjectState: (input) =>
        desktopState.setProject(knownProject(input?.cwd, projects), input),
      openProjectFolder: (input) =>
        Utils.openPath(knownProject(input?.cwd, projects)),
      createProviderAccount: ({ provider, label }) =>
        createProviderAccount(provider, label),
      renameDefaultProviderAccount: ({ provider, label }) => {
        if (!runtime.getProvider(provider)?.auth.oauth?.isSubscription)
          throw new Error("Only subscription accounts are supported.");
        return providerAccounts.renameDefault(provider, label);
      },
      renameProviderAccount: ({ provider, accountId, label }) =>
        renameProviderAccount(provider, accountId, label),
      removeProviderAccount: ({ provider, accountId }) =>
        removeProviderAccount(provider, accountId),
      accountModels: ({ provider, accountId }) =>
        accountModels(provider, accountId),
      logout: async ({ provider, accountId }) => {
        if (typeof provider !== "string" || !runtime.getProvider(provider))
          throw new Error("Invalid provider.");
        await logoutProvider(provider, accountId);
      },
      refreshProviderModels: ({ provider }) => refreshProviderModels(provider),
      setModel: (input) => setSessionModel(input),
      setDefaultModel: async ({ model }) =>
        writeDefaultModel(
          model,
          (await availableModels()).filter((candidate) =>
            isModelEnabled(candidate, modelPreferences.disabled),
          ),
        ),
      setModelEnabled: async ({ provider, id, enabled }) => {
        if (
          typeof enabled !== "boolean" ||
          typeof provider !== "string" ||
          typeof id !== "string" ||
          !runtime.getModel(provider, id)
        )
          throw new Error("Invalid model preference.");
        const next = await modelPreferences.setEnabled(provider, id, enabled);
        setDisabledModels(next);
        return next;
      },
      setModelsEnabled: async ({ provider, ids, enabled }) => {
        if (
          typeof enabled !== "boolean" ||
          !Array.isArray(ids) ||
          !ids.length ||
          ids.length > 1000
        )
          throw new Error("Invalid model preferences.");
        if (
          typeof provider !== "string" ||
          !ids.every(
            (id) => typeof id === "string" && runtime.getModel(provider, id),
          )
        )
          throw new Error("Invalid model preferences.");
        const next = await modelPreferences.setManyEnabled(
          provider,
          ids,
          enabled,
        );
        setDisabledModels(next);
        return next;
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
      setEffort: (input) => setSessionEffort(input),
    },
    messages: {
      checkAppUpdate: () => {
        void appUpdater.check().catch(report);
      },
      installAppUpdate: () => {
        void appUpdater.apply().catch(report);
      },
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
            void confirmDraftsBeforeClose()
              .then((close) => {
                if (close) window.close();
              })
              .catch(report);
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
          if (folder && !projects.includes(folder)) {
            // Adding a folder does not grant trust or load its resources.
            // SessionHost asks through the app's UIRequestBroker on first open.
            await saveProjects((current) =>
              current.includes(folder) ? current : [...current, folder],
            );
          }
          rpc.send.projects(projects);
        })().catch(report);
      },
      startLogin: ({ provider, method, loginId, accountId, addAccount }) => {
        void startLogin(
          provider,
          method,
          loginId,
          (frame) => rpc.send.loginFrame(frame),
          (url) => Utils.openExternal(url),
          accountId,
          addAccount,
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
      connectUI: (input) => sessionHost.connectUI(input),
      disconnectUI: (input) => sessionHost.disconnectUI(input),
      installPackage: (input) => {
        void packageOperation(
          "install",
          input,
          (event) => rpc.send.packageOp(event),
          (items) => rpc.send.installed(items),
          reloadPackages,
          (message) => rpc.send.error({ message }),
        ).catch(console.error);
      },
      uninstallPackage: (input) => {
        void packageOperation(
          "uninstall",
          input,
          (event) => rpc.send.packageOp(event),
          (items) => rpc.send.installed(items),
          reloadPackages,
          (message) => rpc.send.error({ message }),
        ).catch(console.error);
      },
      updatePackage: (input) => {
        void packageOperation(
          "update",
          input,
          (event) => rpc.send.packageOp(event),
          (items) => rpc.send.installed(items),
          reloadPackages,
          (message) => rpc.send.error({ message }),
        ).catch(console.error);
      },
    },
  },
});
const completions = new Map<
  string,
  { track: ReturnType<typeof createCompletionTracker>; running: boolean }
>();
configureSessionHost(
  {
    ui: (event) => rpc.send.extensionUIEvent(event),
    terminal: (event) => rpc.send.terminalEvent(event),
    runtime: (event) => {
      rpc.send.runtimeEvent(packRuntimeEvent(event));
      if (event.type === "closed") completions.delete(event.address.sessionId);
      if (event.type !== "snapshot") return;
      const snapshot = event.snapshot;
      const sessionId = snapshot.address.sessionId;
      const wire = {
        type: "snapshot" as const,
        address: snapshot.address,
        snapshotSeq: snapshot.snapshotSeq,
        transcript: snapshot.transcript,
        failure: snapshot.failure,
        aborted: snapshot.aborted,
      };
      let completion = completions.get(sessionId);
      if (!completion) {
        completion = { track: createCompletionTracker(), running: false };
        completions.set(sessionId, completion);
      }
      const outcome = completion.track(wire);
      const flags = desktopState.value.sessions[sessionId];
      if (
        wire.transcript.running &&
        (!completion.running || flags?.completion || flags?.readCompletionId)
      )
        void desktopState.clearCompletion(sessionId).catch(report);
      completion.running = wire.transcript.running;
      if (!outcome) return;
      void desktopState.completeSession(sessionId, outcome).catch(report);
      const t = dictionary(settings.language);
      const notice: Notice = {
        kind: "completion",
        message:
          outcome === "error"
            ? (wire.failure ?? t["Agent failed"])
            : t["Agent finished"],
        level: outcome,
        session: { id: sessionId, cwd: snapshot.info.cwd },
      };
      rpc.send.notification(notice);
      if (!windowFocused || window.isMinimized()) {
        try {
          Utils.showNotification({ title: "pig", body: notice.message });
        } catch (error) {
          console.error("Cannot show desktop notification", error);
        }
      }
    },
  },
  modelPreferences.disabled,
  {
    read: (id) => desktopState.value.sessions[id]?.accounts ?? {},
    write: (id, accounts) => desktopState.setSessionAccounts(id, accounts),
  },
);
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
// Apply once on ready; Electrobun 2 owns initial client bounds and DPI-aware resizing.
let backdropApplied = false;
window.on("resize", () => {
  rpc.send.windowState({ maximized: window.isMaximized() });
});
// Native navigation invalidates the old Root even if its cooperative unload
// message is lost. Do not disconnect at dom-ready after the new Root connects.
window.webview.on("will-navigate", () => sessionHost.disconnectAll());
window.webview.on("dom-ready", () => {
  rpc.send.windowState({ maximized: window.isMaximized() });
  try {
    if (!backdropApplied) {
      applyBackdrop(window.ptr, appearance);
      backdropApplied = true;
    }
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
let quitReady = false;
let quitting = false;
function confirmDraftsBeforeClose() {
  return flushDraftsBeforeClose(
    () => rpc.request.flushDrafts(),
    async (error) => {
      report(error);
      const t = dictionary(settings.language);
      const { response } = await Utils.showMessageBox({
        type: "warning",
        title: t.draftUnsavedTitle,
        message: t.draftCloseFailed,
        buttons: [t.draftRetry, t.cancel, t.draftCloseUnsaved],
        defaultId: 1,
        cancelId: 1,
      });
      return response === 0 ? "retry" : response === 2 ? "discard" : "cancel";
    },
  );
}
window.on("close", dispose);
Electrobun.events.on("before-quit", (event) => {
  // Native window destruction has already removed its WebView; only ACKed drafts survive that path.
  if (quitReady || !BrowserWindow.getById(window.id)) {
    dispose();
    return;
  }
  event.response = { allow: false };
  if (quitting) return;
  quitting = true;
  void confirmDraftsBeforeClose()
    .then(async (close) => {
      if (!close) return;
      await disposeSessions();
      quitReady = true;
      Utils.quit();
    })
    .catch(report)
    .finally(() => {
      quitting = false;
    });
});
process.on("exit", dispose);

const appUpdater = new AppUpdater(
  process.execPath,
  join(desktopConfigDir, "app-update-result.json"),
  (state) => rpc.send.appUpdate(state),
  async (handoff) => {
    if (quitting) return false;
    quitting = true;
    try {
      const t = dictionary(settings.language);
      const { response } = await Utils.showMessageBox({
        type: "warning",
        title: t.appUpdateTitle,
        message: t.appUpdateConfirm,
        buttons: [t.cancel, t.appUpdateRestart],
        defaultId: 0,
        cancelId: 0,
      });
      if (response !== 1 || !(await confirmDraftsBeforeClose())) return false;
      const commit = await handoff();
      await disposeSessions();
      await commit();
      quitReady = true;
      Utils.quit();
      return true;
    } finally {
      quitting = false;
    }
  },
);
