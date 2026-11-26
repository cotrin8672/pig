/** Opaque identifiers from the paired host, never local working directories. */
export interface RemoteProject {
  id: string;
  name: string;
}
export interface RemoteChatItem {
  chat: string;
  title: string;
}
export interface RemoteTranscript {
  messages: { id: string; role: "assistant" | "user"; text: string }[];
  running: boolean;
  truncated: boolean;
  waitingForHost?: boolean;
  failed?: boolean;
  history?: { before?: string; revision: string };
}
export type RemoteQuery =
  | { op: "projects" }
  | { op: "folders"; parent?: string }
  | { op: "addFolder"; folder: string }
  | { op: "list"; project: string; offset: number }
  | { op: "new"; project: string }
  | { op: "open"; chat: string }
  | { op: "read"; view: string }
  | { op: "history"; view: string; before: string; revision: string }
  | { op: "send"; view: string; id: string; text: string }
  | { op: "receipt"; view: string; id: string };

export interface RemoteResults {
  projects: RemoteProject[];
  folders: RemoteProject[];
  addFolder: RemoteProject;
  list: { total: number; chats: RemoteChatItem[] };
  open: RemoteTranscript & { view: string };
  new: RemoteTranscript & { view: string };
  read: RemoteTranscript;
  history: RemoteTranscript;
  send: { disposition: string };
  receipt: { state: string };
}
