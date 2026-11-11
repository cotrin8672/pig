import type { ImageContent } from "@earendil-works/pi-ai";
import type { DraftAnnotation } from "./annotations";
import type { DraftFile } from "./attachments";
import type { ExtensionStatus, UIRequest } from "./extension-ui";
import type { Snapshot } from "./rpc-schema";

export const UI_HEARTBEAT_INTERVAL_MS = 5_000;
export const UI_CONNECTION_LEASE_MS = 30_000;
export type SessionAddress = {
  hostId: string;
  sessionId: string;
  epoch: number;
};
export type UIAddress = SessionAddress & { uiId: string };
export type SessionPhase = "opening" | "ready" | "closing";
export type OpenSessionParams = { openId: string; cwd: string; id?: string };
export type OpenState =
  | { state: "opening"; address: SessionAddress }
  | { state: "ready"; snapshot: Snapshot }
  | { state: "failed" | "cancelled"; message: string }
  | { state: "unknown" };
export type RuntimeEvent =
  | {
      type: "opening";
      openId?: string;
      previous?: SessionAddress;
      address: SessionAddress;
      cwd: string;
    }
  | { type: "ready"; openId?: string; snapshot: Snapshot }
  | { type: "replaced"; previous: SessionAddress; snapshot: Snapshot }
  | {
      type: "closed";
      address: SessionAddress;
      reason: "close" | "cancelled" | "failed";
      message?: string;
      discardDraft?: true;
    }
  | { type: "snapshot"; snapshot: Snapshot };
export type SendKey = SessionAddress & { requestId: string };
export type PromptAccepted = { disposition: "started" | "queued" | "handled" };
export type PromptReceipt = SendKey &
  (
    | { state: "pending"; stage?: "prepared" | "dispatched" }
    | { state: "accepted"; accepted: PromptAccepted; acceptedAt: number }
    | { state: "rejected"; code: string; message: string }
    | { state: "unknown"; reason: "host-restarted" | "not-found" }
  );
export type DraftContent = {
  text: string;
  pastes: { id: string; marker: string; text: string }[];
  images: { id: string; image: ImageContent }[];
  files?: DraftFile[];
  annotations?: DraftAnnotation[];
};
export type DraftState = DraftContent & {
  revision: number;
  consumedRevision?: number;
};
export type DraftSyncParams = SessionAddress & {
  expectedRevision: number;
  content: DraftContent;
  keepImages?: true;
  requestId?: string;
};
export type DraftSyncResult = { applied: boolean; draft: DraftState };
export type PromptParams = SendKey & {
  text: string;
  images?: ImageContent[];
  draftRevision: number;
};
export type DraftOwner = {
  cwd: string;
  sessionFile: string | null;
  branchId: string | null;
};
export type RecoveredDraft = {
  address: SessionAddress;
  draft: DraftState;
  owner: DraftOwner;
};
export type SendIntent = {
  receipt: PromptReceipt;
  draftRevision: number;
  content?: DraftContent;
  hash: string;
  owner: DraftOwner;
};
export type RuntimeViewState = {
  hostId: string;
  sessions: {
    phase: SessionPhase;
    snapshot?: Snapshot;
    address: SessionAddress;
    openId?: string;
  }[];
  pendingUI: UIRequest[];
  drafts: { address: SessionAddress; draft: DraftState }[];
  statuses: { address: SessionAddress; status: ExtensionStatus }[];
  sendIntents?: SendIntent[];
  retainedDrafts?: RecoveredDraft[];
  recoveryError?: string;
};
export type RuntimeRecoveryState = Pick<
  RuntimeViewState,
  "hostId" | "sendIntents" | "retainedDrafts" | "recoveryError"
>;
