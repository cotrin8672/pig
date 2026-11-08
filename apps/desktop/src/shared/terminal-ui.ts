export type TerminalUIEvent =
  | { type: "open"; id: string; sessionId: string }
  | { type: "data"; id: string; data: string }
  | { type: "close"; id: string };

export type TerminalUICommand =
  | { type: "ready" | "resize"; id: string; cols: number; rows: number }
  | { type: "input"; id: string; data: string }
  | { type: "cancel"; id: string };
