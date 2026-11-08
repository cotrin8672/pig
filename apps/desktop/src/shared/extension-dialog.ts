export type ExtensionDialogRequest = {
  id: string;
  sessionId: string;
  title: string;
} & (
  | { kind: "select"; options: string[] }
  | { kind: "confirm"; message: string }
  | { kind: "input"; placeholder?: string }
  | { kind: "editor"; prefill?: string }
);

export type ExtensionDialogResponse = {
  sessionId: string;
  id: string;
  cancelled?: boolean;
  value?: string | boolean;
};
