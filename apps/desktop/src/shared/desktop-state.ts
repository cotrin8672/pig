import { clampChatWidth } from "./chat-width";

export interface SessionFlags {
  pinned?: boolean;
  archived?: boolean;
  completion?: { id: string; outcome: "success" | "error" };
  readCompletionId?: string;
}
export interface UiPreferences {
  chatWidth?: number;
  recentModels?: string[];
}
export interface DesktopState extends UiPreferences {
  sessions: Record<string, SessionFlags>;
}

export function validateUiPreferences(value: unknown): UiPreferences {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid desktop preferences.");
  const input = value as UiPreferences;
  const next: UiPreferences = {};
  if (input.chatWidth !== undefined) {
    if (
      typeof input.chatWidth !== "number" ||
      !Number.isFinite(input.chatWidth)
    )
      throw new Error("Invalid chat width.");
    next.chatWidth = clampChatWidth(input.chatWidth);
  }
  if (input.recentModels !== undefined) {
    if (
      !Array.isArray(input.recentModels) ||
      input.recentModels.length > 6 ||
      !input.recentModels.every(
        (key) =>
          typeof key === "string" && key.length > 0 && key.length <= 1024,
      )
    )
      throw new Error("Invalid recent models.");
    next.recentModels = [...new Set(input.recentModels)];
  }
  return next;
}
export function validateSessionFlags(value: unknown): SessionFlags {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid session state.");
  const input = value as SessionFlags;
  for (const key of ["pinned", "archived"] as const) {
    if (input[key] !== undefined && typeof input[key] !== "boolean")
      throw new Error("Invalid session state.");
  }
  const validId = (id: unknown) =>
    typeof id === "string" && id.length > 0 && id.length <= 128;
  if (
    input.completion !== undefined &&
    (!input.completion ||
      !validId(input.completion.id) ||
      !["success", "error"].includes(input.completion.outcome))
  )
    throw new Error("Invalid completion.");
  if (input.readCompletionId !== undefined && !validId(input.readCompletionId))
    throw new Error("Invalid read completion ID.");
  return {
    ...(input.pinned !== undefined ? { pinned: input.pinned } : {}),
    ...(input.archived !== undefined ? { archived: input.archived } : {}),
    ...(input.completion !== undefined
      ? { completion: { ...input.completion } }
      : {}),
    ...(input.readCompletionId !== undefined
      ? { readCompletionId: input.readCompletionId }
      : {}),
  };
}
export function validateDesktopState(value: unknown): DesktopState {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid desktop state.");
  const input = value as DesktopState;
  const sessions = input.sessions ?? {};
  if (!sessions || typeof sessions !== "object" || Array.isArray(sessions))
    throw new Error("Invalid session states.");
  return {
    ...validateUiPreferences(input),
    sessions: Object.fromEntries(
      Object.entries(sessions).map(([id, flags]) => {
        if (!id || id.length > 128 || /[\\/\p{Cc}]/u.test(id))
          throw new Error("Invalid session ID.");
        return [id, validateSessionFlags(flags)];
      }),
    ),
  };
}

export function legacyUiPreferences(
  current: UiPreferences,
  width: string | null,
  recent: string | null,
): UiPreferences {
  const next: UiPreferences = {};
  if (
    current.chatWidth === undefined &&
    width !== null &&
    width.trim() &&
    Number.isFinite(Number(width))
  )
    next.chatWidth = clampChatWidth(Number(width));
  if (current.recentModels === undefined && recent !== null) {
    try {
      const value: unknown = JSON.parse(recent);
      if (Array.isArray(value))
        next.recentModels = validateUiPreferences({
          recentModels: value
            .filter((key) => typeof key === "string" && key.length > 0)
            .slice(0, 6),
        }).recentModels;
    } catch {
      /* Keep malformed legacy data untouched. */
    }
  }
  return next;
}
