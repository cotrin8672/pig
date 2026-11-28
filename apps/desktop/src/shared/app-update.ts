export interface AppUpdateState {
  version: string;
  method: "installer" | "disabled";
  status: "idle" | "checking" | "current" | "available" | "preparing" | "error";
  latest?: string;
  error?: string;
}
