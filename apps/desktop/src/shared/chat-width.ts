export const DEFAULT_CHAT_WIDTH = 768;
export function clampChatWidth(width: number) {
  return Number.isFinite(width)
    ? Math.min(1600, Math.max(480, Math.round(width)))
    : DEFAULT_CHAT_WIDTH;
}
