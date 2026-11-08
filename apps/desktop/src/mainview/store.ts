import type { AuthEvent, AuthPrompt } from "@earendil-works/pi-ai";
import { create } from "zustand";
import type {
  Appearance,
  Bootstrap,
  InstalledPackage,
  PackageOpStatus,
  ProviderId,
  SessionInfo,
  Snapshot,
} from "../shared/rpc-schema";

export interface LoginState {
  loginId: string;
  provider: ProviderId;
  event?: AuthEvent;
  authUrl?: Extract<AuthEvent, { type: "auth_url" }>;
  deviceCode?: Extract<AuthEvent, { type: "device_code" }>;
  error?: string;
  prompt?: AuthPrompt;
}
export const useStore = create<{
  bootstrap: Bootstrap;
  sessions: Record<string, SessionInfo[]>;
  snapshots: Record<string, Snapshot>;
  active?: string;
  page: "chat" | "providers" | "extensions";
  installed: InstalledPackage[];
  packageOps: Record<string, PackageOpStatus>;
  packageToast?: { message: string; error: boolean };
  login?: LoginState;
  error?: string;
  opening: boolean;
  appearance: Appearance;
  maximized: boolean;
}>(() => ({
  bootstrap: { projects: [], providers: [], models: [] },
  sessions: {},
  snapshots: {},
  page: "chat",
  installed: [],
  packageOps: {},
  opening: false,
  maximized: false,
  appearance: { backdrop: "none", opacity: 0.85 },
}));
export function showError(error: unknown) {
  const message = String(error);
  useStore.setState({ error: message });
  setTimeout(() => {
    if (useStore.getState().error === message)
      useStore.setState({ error: undefined });
  }, 7000);
}

export function receivePackageOp(op: PackageOpStatus) {
  useStore.setState((s) => ({
    packageOps: { ...s.packageOps, [op.opId]: op },
  }));
  if (op.status === "running") return;
  const verb = {
    install: "Installed",
    uninstall: "Removed",
    update: "Updated",
  }[op.action];
  const toast = {
    message:
      op.status === "error"
        ? op.message
        : `${verb} ${op.source.replace(/^npm:/, "")} — open chats were reloaded`,
    error: op.status === "error",
  };
  useStore.setState({ packageToast: toast });
  setTimeout(() => {
    if (useStore.getState().packageToast === toast)
      useStore.setState({ packageToast: undefined });
  }, 7000);
}
