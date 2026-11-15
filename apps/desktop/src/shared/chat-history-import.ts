export const IMPORTED_HISTORY_PROVIDER = "desktop-import";
/** Desktop apps whose own history files are read directly. */
export type LocalHistorySource = "codex" | "claude-code";
/** Exports (`chatgpt`, `claude`) and local desktop app histories. */
export type ChatHistorySource = "chatgpt" | "claude" | LocalHistorySource;

export type ChatHistoryWarning =
  | "attachments"
  | "tools"
  | "reasoning"
  | "instructions"
  | "unsupported"
  | "branches";

export interface ChatHistoryItem {
  id: string;
  source: ChatHistorySource;
  title: string;
  modified: number;
  messageCount?: number;
  workspace?: string;
  warnings: ChatHistoryWarning[];
}

export interface ChatHistoryPreview {
  id: string;
  kind: "file" | "local";
  source?: LocalHistorySource;
  label: string;
  conversations: ChatHistoryItem[];
  rejected: number;
}

export interface ChatHistoryImportResult {
  copied: number;
  skipped: number;
  failed: number;
  errors?: { id: string; title: string; message: string }[];
}

export interface ChatHistoryFileEvent {
  requestId: string;
  source?: LocalHistorySource;
  preview?: ChatHistoryPreview;
  error?: string;
}
