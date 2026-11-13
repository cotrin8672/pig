import type {
  DraftImagesRef,
  DraftState,
  SessionAddress,
  UIAddress,
} from "./runtime-contract";

export type UIRequest = UIAddress & {
  parentUiId?: string;
  title: string;
  expiresAt?: number;
} & (
    | { kind: "confirm"; message: string }
    | { kind: "select"; options: string[] }
    | { kind: "input"; placeholder?: string; initialValue?: string }
    | { kind: "editor"; initialValue?: string }
    | {
        kind: "project-trust";
        cwd: string;
        fingerprint: string;
        resources: {
          path: string;
          kind: "code" | "settings" | "instructions" | "skill" | "prompt";
        }[];
      }
    | { kind: "terminal" }
  );
export type UIReply = UIAddress &
  (
    | { kind: "cancel" }
    | { kind: "confirm"; value: boolean }
    | { kind: "select" | "input" | "editor"; value: string }
    | { kind: "project-trust"; value: "once" | "persist" | "safe" }
  );
export type ExtensionStatus = {
  statuses: { key: string; text: string }[];
  widgets: {
    key: string;
    lines: string[];
    placement: "aboveEditor" | "belowEditor";
  }[];
  title?: string;
  workingMessage?: string;
  workingSymbol?: string;
  hiddenThinkingLabel?: string;
};
export type ExtensionUIEvent =
  | { type: "request"; request: UIRequest }
  | {
      type: "requestEnd";
      address: UIAddress;
      reason: "done" | "cancelled" | "timeout" | "failed";
    }
  | {
      type: "draft";
      address: SessionAddress;
      draft: DraftState;
      imageRefs?: DraftImagesRef;
    }
  | { type: "status"; address: SessionAddress; status: ExtensionStatus }
  | {
      type: "notify";
      address: SessionAddress;
      level: "info" | "warning" | "error";
      message: string;
    }
  | {
      type: "capability";
      address: SessionAddress;
      api: string;
      supported: boolean;
      message: string;
    };
