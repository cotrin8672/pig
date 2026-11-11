import type { DraftContent } from "../shared/runtime-contract";
import { drafts } from "./draft-store";
import { type OpeningTarget, useStore } from "./store";

export const openingDraftKey = (target: Pick<OpeningTarget, "cwd" | "id">) =>
  target.id ? `${target.cwd}\0${target.id}` : target.cwd;

export function queueOpeningSend(openId: string, content: DraftContent) {
  useStore.setState((state) => {
    const pending = state.pendingOpens[openId];
    if (!pending) return {};
    const next = {
      ...pending,
      queuedSends: [
        ...(pending.queuedSends ?? []),
        {
          id: crypto.randomUUID(),
          content: structuredClone(content),
          timestamp: Date.now(),
        },
      ],
    };
    return {
      pendingOpens: { ...state.pendingOpens, [openId]: next },
      ...(state.openId === openId ? { openingTarget: next } : {}),
    };
  });
}
export function removeOpeningSend(openId: string, id: string) {
  useStore.setState((state) => {
    const pending = state.pendingOpens[openId];
    if (!pending) return {};
    const next = {
      ...pending,
      queuedSends: pending.queuedSends?.filter((send) => send.id !== id),
    };
    return {
      pendingOpens: { ...state.pendingOpens, [openId]: next },
      ...(state.openId === openId ? { openingTarget: next } : {}),
    };
  });
}
export function restoreOpeningSends(openId: string) {
  const state = useStore.getState();
  const pending = state.pendingOpens[openId];
  if (!pending?.queuedSends?.length) return;
  const snapshot = pending.id && state.snapshots[pending.id];
  for (const send of [...pending.queuedSends].reverse()) {
    if (snapshot) drafts.restoreSent(snapshot.address, send.content);
    else {
      const key = openingDraftKey(pending);
      useStore.setState((s) => ({
        newChatDrafts: {
          ...s.newChatDrafts,
          [key]: [send.content.text, s.newChatDrafts[key]]
            .filter(Boolean)
            .join("\n\n"),
        },
      }));
    }
  }
}
