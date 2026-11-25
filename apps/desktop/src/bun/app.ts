import { stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { accountSourceKey } from "../shared/account-models";
import type { AppUpdateState } from "../shared/app-update";
import type { RpcHandlers } from "../shared/desktop-rpc";
import { dictionary } from "../shared/i18n";
import { sanitizeOverride } from "../shared/model-overrides";
import { isModelEnabled } from "../shared/models";
import {
  type NewNotice,
  type NoticeRecord,
  newNoticeRecord,
} from "../shared/notification-history";
import { knownProject, withoutProject } from "../shared/projects";
import type {
  InstalledPackage,
  PackageOpStatus,
  SessionTarget,
  Snapshot,
} from "../shared/rpc-schema";
import type {
  OpenSessionParams,
  SessionAddress,
} from "../shared/runtime-contract";
import { sessionIdFromLink } from "../shared/session-links";
import { patchSettings } from "../shared/settings";
import { AppUpdater } from "./app-update";
import {
  loadAppearance,
  saveAppearance,
  validateAppearance,
} from "./appearance";
import { attachmentPreview, storeFile } from "./attachments";
import { ChatHistoryImports } from "./chat-history-import";
import { ChatRendererLoader } from "./chat-renderer-loader";
import { ClientHub } from "./client-hub";
import { createCompletionNotifier } from "./completion-notifier";
import { readDefaultModel, writeDefaultModel } from "./default-model";
import {
  desktopConfigDir,
  generalCwd,
  prepareDesktopConfig,
} from "./desktop-config";
import { type DesktopWindow, desktopPlatform } from "./desktop-platform";
import { DesktopStateStore } from "./desktop-state";
import { flushDraftsBeforeClose } from "./draft-close";
import { showEditMenu } from "./edit-menu";
import { listFontFamilies } from "./fonts";
import {
  copyImage,
  readClipboardImage,
  saveImage,
  showImageMenu,
} from "./images";
import { InstallerUpdater } from "./installer-updater";
import { LocalChatHistory } from "./local-chat-history";
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
import { addMiseNodeToPath } from "./mise-node-path";
import { ModelPreferences } from "./model-preferences";
import {
  readModelOverrides,
  writeDefaultEffort,
  writeModelOverride,
} from "./model-settings";
import { NotificationHistory } from "./notification-history";
import { coalescePackageReload, withPackageLock } from "./package-queue";
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
  getStatistics,
  listProviders,
  listSessions,
  modelErrors,
  modelInfo,
  openSession,
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
import { searchProjectPaths } from "./project-files";
import { ProjectStore } from "./project-store";
import { providerAccounts } from "./provider-accounts";
import { remoteChat } from "./remote-chat";
import { revealPath } from "./reveal-path";
import { agentDir, agentDirSource } from "./runtime-profile";
import { defaultSessionDir, SearchIndex } from "./search-index";
import { sessionDirFor } from "./session-files";
import { loadSettings, saveSettings } from "./settings";
import { TerminalRouter } from "./terminal-router";
import {
  packRuntimeState,
  packSnapshot,
  packTranscript,
} from "./transcript-wire";
import { discoverUsageTargets, receiveUsageObservation } from "./usage/host";
import { setUsageObserver } from "./usage/observation";
import { UsageService } from "./usage/service";

const platform = desktopPlatform();
await Promise.all([
  prepareDesktopConfig(platform.userData),
  addMiseNodeToPath(),
]);
/** Every open window's UI; publications go to all of them. */
const hub = new ClientHub(sessionHost.hostId);
sessionHost.onConfigApplied = () => {
  void sessionHost
    .actionKeymaps()
    .then((keymaps) => hub.broadcast("actionKeymaps", keymaps));
};
// Paths only (never values): GUI env can differ from the user's shell.
console.info(`Pi agent directory: ${agentDir} (${agentDirSource})`);
const chatRendererLoader = new ChatRendererLoader(
  join(desktopConfigDir, "chat-renderers.tsx"),
);
const desktopState = new DesktopStateStore(
  join(desktopConfigDir, "desktop.json"),
  (state) => hub.broadcast("desktopState", state),
);
const notificationHistory = new NotificationHistory(
  join(desktopConfigDir, "notifications.json"),
  (state) => hub.broadcast("noticeHistory", state),
);
function publishNotice(notice: NewNotice, windowId?: string) {
  const toast = (record: NoticeRecord) => {
    if (windowId === undefined) hub.broadcast("notification", record);
    else hub.to(windowId, "notification", record);
  };
  void notificationHistory.append(notice, toast).catch((error) => {
    console.error("Cannot save notification history:", error);
    toast(newNoticeRecord(notice));
  });
}

const modelPreferences = new ModelPreferences(
  join(desktopConfigDir, "disabled-models.json"),
);
const projectStore = new ProjectStore(
  join(desktopConfigDir, "projects.json"),
  generalCwd,
);
await Promise.all([
  desktopState.load(),
  notificationHistory.load(),
  modelPreferences.load(),
  projectStore.load(),
]);
const validateScope = (cwd: string) => projectStore.validateScope(cwd);
export const remoteRequest = remoteChat(sessionHost, () => [
  generalCwd,
  ...projectStore.value,
]);
const samePath = (a: string, b: string) =>
  process.platform === "win32"
    ? resolve(a).toLowerCase() === resolve(b).toLowerCase()
    : resolve(a) === resolve(b);
/**
 * Imported chats go back to their original folder, registering it as a project
 * when needed. Like addProject this grants no trust; the first new chat asks.
 * Chats without a folder that still exists go to general chat.
 */
async function importScope(workspace?: string) {
  if (!workspace || samePath(workspace, generalCwd)) return generalCwd;
  const known = () => projectStore.value.find((p) => samePath(p, workspace));
  if (known()) return known() as string;
  const folder = resolve(workspace);
  if (
    !(await stat(folder).then(
      (s) => s.isDirectory(),
      () => false,
    ))
  )
    return generalCwd;
  await projectStore.save((current) =>
    current.some((p) => samePath(p, folder)) ? current : [...current, folder],
  );
  hub.broadcast("projects", projectStore.value);
  return known() ?? folder;
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
const searchIndex = new SearchIndex(join(desktopConfigDir, "search.sqlite"));
/** Registered workspaces grouped by the directory their chats are stored in. */
async function searchRoots() {
  const roots = new Map<string, string[]>();
  for (const cwd of new Set([generalCwd, ...projectStore.value])) {
    const dir = (await sessionDirFor(cwd)) ?? defaultSessionDir(cwd, agentDir);
    roots.set(dir, [...(roots.get(dir) ?? []), cwd]);
  }
  return [...roots].map(([dir, cwds]) => ({ dir, cwds }));
}
function refreshSearch() {
  void searchIndex.refresh(searchRoots).catch(console.error);
}
// Warm the index after startup work has settled.
setTimeout(refreshSearch, 5000);
async function openManagedSession(input: OpenSessionParams) {
  return fullSnapshot(await openSession(input));
}
function fullSnapshot(snapshot: Snapshot) {
  // RPC reads advance snapshotSeq independently of publications.
  hub.resetRuntime(snapshot.address);
  return packSnapshot(snapshot);
}
async function withRuntime<T extends SessionAddress, R>(
  input: T,
  action: (input: T) => R,
): Promise<Awaited<R>> {
  if (sessionHost.isSuspended(input)) {
    const snapshot = await sessionHost.wakeSession(input);
    if (
      snapshot.address.hostId !== input.hostId ||
      snapshot.address.sessionId !== input.sessionId ||
      snapshot.address.epoch !== input.epoch
    )
      throw new Error("STALE_SESSION_ADDRESS");
  }
  // No await before dispatch on an already-live runtime.
  return await action(input);
}
const settingsFile = join(desktopConfigDir, "settings.json");
const appearanceFile = join(desktopConfigDir, "appearance.json");
let [settings, appearance] = await Promise.all([
  loadSettings(settingsFile, platform.defaultShell),
  loadAppearance(appearanceFile),
]);
let settingsQueue = Promise.resolve();
let appearanceQueue = Promise.resolve();
function updateAppearance(value: unknown) {
  appearanceQueue = appearanceQueue
    .then(async () => {
      const next = validateAppearance(value);
      // Colour/opacity previews must not reconfigure DWM or redraw the native frame.
      // Apply before persisting so a rejected backdrop is never saved at startup.
      if (next.backdrop !== appearance.backdrop)
        for (const target of windows.values())
          await target.window.applyBackdrop(next);
      await saveAppearance(appearanceFile, next);
      appearance = next;
      hub.broadcast("appearance", appearance);
    })
    .catch((error) => {
      report(error);
      // Let the UI revert to what is actually applied.
      hub.broadcast("appearance", appearance);
    });
}
const report = (error: unknown) => {
  console.error(error);
  publishNotice({ level: "error", message: String(error) });
};
function publishPackageOp(op: PackageOpStatus) {
  hub.broadcast("packageOp", op);
  if (op.status === "running") return;
  publishNotice({
    kind: "package",
    level: op.status === "error" ? "error" : "success",
    message:
      op.status === "error"
        ? op.message
        : dictionary(settings.language).packageDone(
            op.action,
            op.source.replace(/^npm:/, ""),
          ),
  });
}
const publishInstalledUpdate = (items: InstalledPackage[]) =>
  hub.broadcast("installed", items);
function publishInstalled(items: InstalledPackage[]) {
  publishInstalledUpdate(items);
  void listInstalled(publishInstalledUpdate).catch(report);
}
const reloadPackages = coalescePackageReload(async () => {
  await withPackageLock(async () => {});
  const failures: string[] = [];
  await Promise.all([
    refreshUserCatalog().then(
      (diagnostics) => failures.push(...diagnostics),
      (error) => failures.push(String(error)),
    ),
    sessionHost
      .reloadPackageExtensions()
      .then((errors) => failures.push(...errors)),
  ]);
  return failures;
});
const usageService = new UsageService(discoverUsageTargets, (entries) =>
  hub.broadcast("providerUsage", entries),
);
setUsageObserver((event) => receiveUsageObservation(usageService, event));
type RequestHandlers = RpcHandlers<"bun">["requests"];
type MessageHandlers = RpcHandlers<"bun">["messages"];
type AppWindow = {
  id: string;
  window: DesktopWindow;
  focused: boolean;
  usageActive: boolean;
  /** Root UI leases created by this window's current page. */
  uiClients: Set<string>;
  flushDrafts: () => Promise<void>;
  historyImports: ChatHistoryImports;
  localHistory: LocalChatHistory;
  historyPickerOpen: boolean;
  historyRequest?: string;
};
const windows = new Map<string, AppWindow>();
/** Windows whose native WebView still exists (close events may arrive later). */
const liveWindows = () =>
  [...windows.values()].filter((target) => target.window.isAlive());
const terminals = new TerminalRouter(
  {
    broadcast: (event) => hub.terminal(event),
    to: (client, event) => hub.terminal(event, client),
  },
  (address) =>
    sessionHost.terminalCommand({
      ...address,
      hostId: sessionHost.hostId,
      type: "cancel",
    }),
);
/** Window-independent API: identical for every UI client. */
const hostRequests = {
  getAppUpdate: () =>
    appUpdater?.info() ??
    ({
      version: platform.version,
      method: "disabled",
      status: "idle",
      reason: "development",
    } satisfies AppUpdateState),
  getPiData: () => piDataReport(),
  importLegacyAuth: async ({ file, providers }) => {
    if (
      typeof file !== "string" ||
      !Array.isArray(providers) ||
      !providers.every((id) => typeof id === "string")
    )
      throw new Error("Invalid import request.");
    const result = await importLegacyAuth(file, providers);
    if (result.copied) await refreshModels({ providers, allowNetwork: false });
    return result;
  },
  importLegacySessions: () => importLegacySessions(),
  getChatRendererBundle: () => chatRendererLoader.load(),
  searchPackages: (input) => searchPackages(input),
  packagePreviews: (input) => packagePreviews(input),
  listInstalled: () => listInstalled(publishInstalledUpdate),
  getOpenState: async (input) => {
    const state = await sessionHost.readOpenState(input);
    return state.state === "ready"
      ? { ...state, snapshot: fullSnapshot(state.snapshot) }
      : state;
  },
  cancelOpen: (input) => sessionHost.cancelOpen(input),
  getSessionSnapshot: async (input) =>
    fullSnapshot(await sessionHost.readSessionSnapshot(input)),
  getMcpAppPreview: (input) =>
    sessionHost.getMcpAppPreview(
      input,
      platform.interactiveWidgets === true && input?.interactive === true,
    ),
  wakeSession: async (input) =>
    fullSnapshot(await sessionHost.wakeSession(input)),
  getSessionHistory: async (input) =>
    packTranscript(await sessionHost.getSessionHistory(input)),
  listSlashCommands: (input) => sessionHost.listSlashCommands(input),
  completeSlashArguments: (input) =>
    withRuntime(input, (value) => sessionHost.completeSlashArguments(value)),
  getPromptReceipt: (input) => sessionHost.getPromptReceipt(input),
  cancelPrompt: (input) => sessionHost.cancelPrompt(input),
  acknowledgePromptRecovery: (input) =>
    sessionHost.acknowledgePromptRecovery(input),
  reorderQueuedPrompts: (input) => sessionHost.reorderQueuedPrompts(input),
  steerQueuedPrompt: (input) => sessionHost.steerQueuedPrompt(input),
  getRecovery: (input) => sessionHost.readRecovery(input),
  syncDraft: (input) => sessionHost.syncDraft(input),
  getSessionDraft: (input) => sessionHost.getSessionDraft(input),
  discardRecovery: (input) =>
    withRuntime(input.current, () => sessionHost.discardRecovery(input)),
  resolveExtensionUI: (input) => sessionHost.resolveExtensionUI(input),
  runtimeState: () =>
    hub.runtimeState(() => packRuntimeState(sessionHost.runtimeState())),
  heartbeatUI: (input) => sessionHost.heartbeatUI(input),
  abort: (input) => abortSession(input),
  closeSession: (input) => closeSession(input),
  reloadSession: (input) =>
    withRuntime(input, (value) => sessionHost.reloadSession(value)),
  invokeSessionAction: (input) =>
    withRuntime(input, (value) => sessionHost.invokeSessionAction(value)),
  reloadAdapterConfig: () => sessionHost.reloadAdapterConfig(),
  actionKeymaps: () => sessionHost.actionKeymaps(),
  readClipboardImage,
  attachmentPreview: ({ path }) => attachmentPreview(path),
  saveImage: ({ src }) => saveImage(src),
  storeAttachment: ({ name, data }) => storeFile(name, data),
  appearance: () => appearance,
  settings: () => settings,
  providerUsage: () => usageService.snapshot(),
  statistics: ({ period }) => getStatistics(period),
  refreshProviderUsage: () => usageService.refresh(true),
  listFontFamilies,
  bootstrap: async () => {
    for (const message of modelErrors.splice(0)) report(message);
    const [providers, models, utilities, modelOverrides] = await Promise.all([
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
      projects: projectStore.value,
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
  searchProjectPaths: async ({ cwd, query }) => {
    if (typeof query !== "string") throw new Error("Invalid search.");
    await validateScope(cwd);
    return searchProjectPaths(cwd, query.slice(0, 200));
  },
  searchConversations: ({ query, refresh }) => {
    if (typeof query !== "string") throw new Error("Invalid search.");
    if (refresh) refreshSearch();
    return {
      hits: searchIndex.search(query.slice(0, 200)),
      indexing: searchIndex.indexing,
    };
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
    searchIndex.forget(info.id);
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
    for (const cwd of new Set([generalCwd, ...projectStore.value])) {
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
    throw new Error("Chat not found in registered projects or general chats.");
  },
  openSession: async (input) => {
    await validateScope(input.cwd);
    // SessionHost validates persisted membership while resolving the file.
    return openManagedSession(input);
  },
  rewindSession: async (input) =>
    fullSnapshot(await withRuntime(input, rewindSession)),
  forkSession: async (input) =>
    fullSnapshot(await withRuntime(input, forkSession)),
  removeProject: (input) =>
    projectStore.save((current) => withoutProject(current, input?.cwd)),
  setProjectState: (input) =>
    desktopState.setProject(
      knownProject(input?.cwd, projectStore.value),
      input,
    ),
  openProjectFolder: (input) =>
    platform.openPath(knownProject(input?.cwd, projectStore.value)),
  createProviderAccount: ({ provider, label }) =>
    createProviderAccount(provider, label),
  renameDefaultProviderAccount: ({ provider, label }) => {
    if (!runtime.getProvider(provider)?.auth.oauth?.isSubscription)
      throw new Error("Only subscription accounts are supported.");
    return providerAccounts.renameDefault(provider, label);
  },
  renameProviderAccount: ({ provider, accountId, label }) =>
    renameProviderAccount(provider, accountId, label),
  removeProviderAccount: async ({ provider, accountId }) => {
    await removeProviderAccount(provider, accountId);
    usageService.invalidate(provider);
  },
  accountModels: ({ provider, accountId }) =>
    accountModels(provider, accountId),
  logout: async ({ provider, accountId }) => {
    if (typeof provider !== "string" || !runtime.getProvider(provider))
      throw new Error("Invalid provider.");
    await logoutProvider(provider, accountId);
    usageService.invalidate(provider);
  },
  refreshProviderModels: ({ provider }) => refreshProviderModels(provider),
  setModel: (input) => withRuntime(input, setSessionModel),
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
    const next = await modelPreferences.setManyEnabled(provider, ids, enabled);
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
    if (effort !== null && !modelInfo(model).thinkingLevels?.includes(effort))
      throw new Error("Unsupported reasoning effort.");
    await writeDefaultEffort(provider, id, effort);
    await applyModelSettings();
  },
  setEffort: (input) => withRuntime(input, setSessionEffort),
} satisfies Omit<
  RequestHandlers,
  | "copyImage"
  | "terminalCommand"
  | "importChatHistory"
  | "noticeHistory"
  | "prompt"
>;
/** Window-independent messages. */
const hostMessages = {
  checkAppUpdate: () => {
    clearTimeout(lazyUpdateCheck);
    void appUpdater?.check().catch(report);
  },
  installAppUpdate: () => {
    void appUpdater?.apply().catch(report);
  },
  setSettings: (patch) => {
    settingsQueue = settingsQueue
      .then(async () => {
        const next = patchSettings(settings, patch);
        await saveSettings(settingsFile, next);
        const channelChanged = next.includeNightly !== settings.includeNightly;
        settings = next;
        hub.broadcast("settings", settings);
        if (channelChanged && appUpdater instanceof InstallerUpdater)
          void appUpdater.check();
      })
      .catch((error) => {
        report(error);
        hub.broadcast("settings", settings);
      });
  },
  setAppearance: (value) => updateAppearance(value),
  // Windows folder dialogs can stall inside RPC requests (Electrobun #156).
  addProject: () => {
    void (async () => {
      const folder = await platform.choosePath("folder");
      if (folder && !projectStore.value.includes(folder)) {
        // Adding a folder does not grant trust or load its resources.
        // SessionHost asks through the app's UIRequestBroker on first open.
        await projectStore.save((current) =>
          current.includes(folder) ? current : [...current, folder],
        );
      }
      hub.broadcast("projects", projectStore.value);
    })().catch(report);
  },
  startLogin: ({ provider, method, loginId, accountId, addAccount }) => {
    void startLogin(
      provider,
      method,
      loginId,
      (frame) => {
        // Other windows ignore foreign frames but refresh on success.
        hub.broadcast("loginFrame", frame);
        if (frame.kind === "success") usageService.invalidate(provider);
      },
      (url) => platform.openExternal(url),
      accountId,
      addAccount,
    ).catch(report);
  },
  resolveLogin: ({ loginId, value }) => resolveLogin(loginId, value),
  cancelLogin: ({ loginId }) => cancelLogin(loginId),
  openExternal: ({ url }) => {
    if (typeof url === "string" && /^https?:\/\//i.test(url))
      platform.openExternal(url);
  },
  revealPath: (input) => {
    void revealPath(input, platform, validateScope).catch(report);
  },
  installPackage: (input) => {
    void packageOperation(
      "install",
      input,
      publishPackageOp,
      publishInstalled,
      reloadPackages,
      report,
    ).catch(console.error);
  },
  uninstallPackage: (input) => {
    void packageOperation(
      "uninstall",
      input,
      publishPackageOp,
      publishInstalled,
      reloadPackages,
      report,
    ).catch(console.error);
  },
  updatePackage: (input) => {
    void packageOperation(
      "update",
      input,
      publishPackageOp,
      publishInstalled,
      reloadPackages,
      report,
    ).catch(console.error);
  },
} satisfies Omit<
  MessageHandlers,
  | "usageActive"
  | "windowControl"
  | "imageMenu"
  | "editMenu"
  | "connectUI"
  | "disconnectUI"
  | "runtimeUsage"
  | "chooseChatHistory"
  | "discardChatHistory"
  | "listChatHistory"
>;
const notifyCompletion = createCompletionNotifier({
  desktopState,
  language: () => settings.language,
  report,
  notify: publishNotice,
  attended: () =>
    [...windows.values()].some(
      (target) => target.focused && !target.window.isMinimized(),
    ),
  showSystemNotification: (body) => platform.showNotification(body),
});
configureSessionHost(
  {
    ui: (event) => hub.extension(event),
    terminal: (event) => terminals.event(event),
    runtime: (event) => {
      hub.runtime(event);
      if (event.type === "closed" && event.reason === "failed" && event.message)
        publishNotice({ level: "error", message: event.message });
      notifyCompletion(event);
    },
  },
  modelPreferences.disabled,
  {
    read: (id) => desktopState.value.sessions[id]?.accounts ?? {},
    write: (id, accounts) => desktopState.setSessionAccounts(id, accounts),
  },
);
const syncUsageActive = () =>
  usageService.setActive(
    [...windows.values()].some((target) => target.usageActive),
  );
/** The page went away (reload, navigation or close): end what only it owned. */
function releasePage(target: AppWindow) {
  target.historyRequest = undefined;
  target.historyImports.clear();
  target.localHistory.clear();
  for (const clientId of target.uiClients)
    sessionHost.disconnectUI({ clientId });
  target.uiClients.clear();
  terminals.drop(target.id);
  hub.reset(target.id);
  if (target.usageActive) {
    target.usageActive = false;
    syncUsageActive();
  }
}
function createWindow() {
  const id = `pig-${crypto.randomUUID()}`;
  // Completed below; handlers only run once the window exists.
  const target = { id } as AppWindow;
  const handlers: RpcHandlers<"bun"> = {
    requests: {
      ...hostRequests,
      prompt: (input) =>
        withRuntime(input, (params) =>
          sessionHost.prompt(params, (admission) =>
            hub.to(id, "promptAdmitted", admission),
          ),
        ),
      noticeHistory: (input) =>
        notificationHistory.request(input, (record) =>
          hub.to(id, "notification", record),
        ),
      importChatHistory: async (input) => {
        const scopes = new Set<string>();
        const place = async (workspace?: string) => {
          const cwd = await importScope(workspace);
          scopes.add(cwd);
          return cwd;
        };
        // Exports carry no folder, so they always go to general chat.
        const result = await (target.localHistory.owns(input?.previewId)
          ? target.localHistory.import({ ...input, cwd: place })
          : target.historyImports.import({
              ...input,
              cwd: await place(),
            }));
        if (result.copied) {
          refreshSearch();
          for (const cwd of scopes) hub.broadcast("chatsImported", { cwd });
        }
        return result;
      },
      copyImage: ({ src }) => copyImage(src, target.window.ptr),
      terminalCommand: (input) => {
        if (terminals.accept(id, input)) sessionHost.terminalCommand(input);
      },
    },
    messages: {
      ...hostMessages,
      listChatHistory: ({ requestId, source }) => {
        if (
          typeof requestId !== "string" ||
          requestId.length > 128 ||
          (source !== "codex" && source !== "claude-code")
        )
          return;
        target.historyRequest = requestId;
        target.historyImports.clear();
        void target.localHistory
          .list(source)
          .then((preview) => {
            if (target.historyRequest === requestId)
              hub.to(id, "chatHistoryFile", { requestId, preview });
          })
          .catch((error) => {
            if (target.historyRequest === requestId)
              hub.to(id, "chatHistoryFile", {
                requestId,
                error: String(error),
              });
          });
      },
      chooseChatHistory: ({ requestId }) => {
        if (typeof requestId !== "string" || requestId.length > 128) return;
        if (target.historyPickerOpen) {
          hub.to(id, "chatHistoryFile", {
            requestId,
            error: "A file picker is already open.",
          });
          return;
        }
        target.historyPickerOpen = true;
        target.historyRequest = requestId;
        target.localHistory.clear();
        const imports = target.historyImports;
        void (async () => {
          const file = await platform.choosePath("json");
          if (target.historyRequest !== requestId) return;
          if (!file) {
            imports.clear();
            hub.to(id, "chatHistoryFile", { requestId });
            return;
          }
          const preview = await imports.prepare(file);
          if (target.historyRequest !== requestId) return;
          hub.to(id, "chatHistoryFile", { requestId, preview });
        })()
          .catch((error) => {
            hub.to(id, "chatHistoryFile", {
              requestId,
              error: String(error),
            });
          })
          .finally(() => {
            target.historyPickerOpen = false;
          });
      },
      discardChatHistory: () => {
        target.historyRequest = undefined;
        target.historyImports.clear();
        target.localHistory.clear();
      },
      usageActive: ({ active }) => {
        if (typeof active !== "boolean") return;
        target.usageActive = active;
        syncUsageActive();
      },
      windowControl: (value) => {
        // RPC input is untrusted even though the webview has a typed sender.
        if (!value || typeof value !== "object") return;
        switch (value.action) {
          case "minimize":
            target.window.minimize();
            break;
          case "toggleMaximize":
            target.window.toggleMaximize();
            break;
          case "close":
            requestWindowClose(target);
            break;
        }
      },
      editMenu: (request) => {
        const t = dictionary(settings.language);
        try {
          showEditMenu(
            request,
            t.editMenu,
            (command) => hub.to(id, "editMenuCommand", command),
            report,
          );
        } catch (error) {
          report(error);
        }
      },
      imageMenu: ({ src }) => {
        const t = dictionary(settings.language);
        showImageMenu(
          src,
          { copy: t["Copy image"], save: t["Save image"] },
          () => target.window.ptr,
          report,
        );
      },
      connectUI: (input) => {
        sessionHost.connectUI(input);
        target.uiClients.add(input.clientId);
      },
      runtimeUsage: (input) => {
        if (target.uiClients.has(input.clientId))
          sessionHost.runtimeUsage(input);
      },
      disconnectUI: (input) => {
        target.uiClients.delete(input?.clientId);
        sessionHost.disconnectUI(input);
      },
    },
  };
  const window = platform.createWindow(id, 32 * (windows.size % 8), handlers);
  Object.assign(target, {
    window,
    focused: true,
    usageActive: false,
    uiClients: new Set<string>(),
    flushDrafts: () => window.flushDrafts(),
    historyImports: new ChatHistoryImports(),
    localHistory: new LocalChatHistory(),
    historyPickerOpen: false,
  } satisfies Omit<AppWindow, "id">);
  for (const other of windows.values()) other.focused = false;
  windows.set(id, target);
  hub.add(id, window.send);
  window.on("focus", () => {
    for (const other of windows.values()) other.focused = other === target;
  });
  window.on("blur", () => {
    target.focused = false;
  });
  // Apply once on ready. The platform owns sizing and DPI changes.
  let backdropApplied = false;
  window.on("resize", () => {
    hub.to(id, "windowState", { maximized: window.isMaximized() });
  });
  // Native navigation invalidates the old Root even if its cooperative unload
  // message is lost. Do not disconnect at dom-ready after the new Root connects.
  window.on("navigate", () => releasePage(target));
  window.on("ready", () => {
    hub.to(id, "windowState", { maximized: window.isMaximized() });
    if (backdropApplied) return;
    backdropApplied = true;
    void Promise.resolve()
      .then(() => window.applyBackdrop(appearance))
      .catch((error) => {
        console.error("Cannot apply backdrop:", error);
        publishNotice({ level: "error", message: String(error) }, id);
      });
  });
  window.on("closeRequested", () => requestWindowClose(target));
  window.on("close", () => {
    releasePage(target);
    hub.remove(id);
    windows.delete(id);
    // Closing the last window quits the app (Electrobun exitOnLastWindowClosed).
    if (!windows.size) dispose();
  });
  return target;
}
/** Opens another window onto the same host, e.g. for a second app launch. */
export function openWindow() {
  createWindow();
}
createWindow();
console.log("[window] pig started");
function dispose() {
  setUsageObserver(undefined);
  usageService.dispose();
  cancelAllLogins();
  void disposeSessions().catch(console.error);
}
let quitReady = false;
let quitting = false;
function confirmDraftsBeforeClose(targets = liveWindows()) {
  return flushDraftsBeforeClose(
    () => Promise.all(targets.map((target) => target.flushDrafts())),
    async (error) => {
      report(error);
      const t = dictionary(settings.language);
      const response = await platform.showMessageBox({
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
const closingWindows = new Set<string>();
function requestWindowClose(target: AppWindow) {
  if (closingWindows.has(target.id)) return;
  closingWindows.add(target.id);
  void confirmDraftsBeforeClose([target])
    .then((close) => {
      if (close) target.window.close();
    })
    .catch(report)
    .finally(() => closingWindows.delete(target.id));
}
platform.onBeforeQuit(() => {
  // Even after the last WebView closes, await session shutdown and statistics flush.
  if (quitReady) {
    dispose();
    return true;
  }
  if (quitting) return false;
  quitting = true;
  void confirmDraftsBeforeClose()
    .then(async (close) => {
      if (!close) return;
      await disposeSessions();
      await notificationHistory.settled();
      quitReady = true;
      platform.quit();
    })
    .catch(report)
    .finally(() => {
      quitting = false;
    });
  return false;
});
process.on("exit", dispose);

const shutdownForUpdate: ConstructorParameters<typeof AppUpdater>[3] = async (
  handoff,
) => {
  if (quitting) return false;
  quitting = true;
  try {
    const t = dictionary(settings.language);
    const response = await platform.showMessageBox({
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
    platform.quit();
    return true;
  } finally {
    quitting = false;
  }
};
const notifyUpdate = (state: AppUpdateState) =>
  hub.broadcast("appUpdate", state);
const appUpdater = platform.installerUpdater
  ? new InstallerUpdater(
      platform.version,
      platform.installerUpdater,
      () => settings.includeNightly,
      notifyUpdate,
      shutdownForUpdate,
    )
  : platform.usesLegacyUpdater
    ? new AppUpdater(
        process.execPath,
        join(desktopConfigDir, "app-update-result.json"),
        notifyUpdate,
        shutdownForUpdate,
      )
    : undefined;
// Lazy: well after startup work settles, check once quietly; never on the startup path.
const lazyUpdateCheck =
  appUpdater &&
  setTimeout(() => {
    void appUpdater.check({ background: true }).catch(console.warn);
  }, 30_000);
