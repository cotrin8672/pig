import type { ModelSelection } from "../shared/rpc-schema";
import type { DraftContent, PromptDelivery } from "../shared/runtime-contract";
import type { AttachmentClaim } from "./attachment-reads";
import { drafts } from "./draft-store";
import { type OpeningOp, type OpeningTarget, useStore } from "./store";

export const openingDraftKey = (
  target: Pick<OpeningTarget, "cwd" | "id" | "draftId">,
) => target.draftId ?? (target.id ? `${target.cwd}\0${target.id}` : target.cwd);

function update(
  openId: string,
  change: (target: OpeningTarget) => Partial<OpeningTarget>,
) {
  useStore.setState((state) => {
    const pending = state.pendingOpens[openId];
    if (!pending) return {};
    const next = { ...pending, ...change(pending) };
    return {
      pendingOpens: { ...state.pendingOpens, [openId]: next },
      ...(state.openId === openId ? { openingTarget: next } : {}),
    };
  });
}
export const openingSends = (target?: OpeningTarget) =>
  (target?.queued ?? []).flatMap((op) => (op.kind === "send" ? [op] : []));

export function queueOpeningSend(
  openId: string,
  content: DraftContent,
  delivery: PromptDelivery = "steer",
  attachments?: AttachmentClaim,
) {
  update(openId, (target) => ({
    queued: [
      ...(target.queued ?? []),
      {
        id: crypto.randomUUID(),
        kind: "send",
        content: structuredClone(content),
        timestamp: Date.now(),
        delivery,
        attachments,
      },
    ],
  }));
}
/** The picker shows the latest choice; earlier sends keep the choice they were made with. */
export function queueOpeningSelection(
  openId: string,
  selection: ModelSelection,
) {
  update(openId, (target) => ({
    selection,
    queued: [
      ...(target.queued ?? []),
      { id: crypto.randomUUID(), kind: "select", selection },
    ],
  }));
}
export function takeOpeningOps(openId: string): OpeningOp[] {
  const ops = useStore.getState().pendingOpens[openId]?.queued ?? [];
  update(openId, () => ({ queued: [] }));
  return ops;
}
export function withdrawOpeningSend(openId: string, id: string) {
  const send = openingSends(useStore.getState().pendingOpens[openId]).find(
    (item) => item.id === id,
  );
  update(openId, (target) => ({
    queued: target.queued?.filter((op) => op.id !== id),
  }));
  return send;
}

function restoreDraft(
  target: OpeningTarget,
  send: Extract<OpeningOp, { kind: "send" }>,
) {
  const state = useStore.getState();
  const key = openingDraftKey(target);
  const address = target.id ? state.snapshots[target.id]?.address : undefined;
  const owner = address ?? key;
  const loaded = send.attachments?.restore(owner);
  const content = loaded
    ? {
        ...send.content,
        images: [...send.content.images, ...loaded.images],
        files: [...(send.content.files ?? []), ...(loaded.files ?? [])],
      }
    : send.content;
  drafts.restoreSent(owner, address ? content : { ...content, text: "" });
  if (address) return;
  useStore.setState((s) => ({
    newChatDrafts: {
      ...s.newChatDrafts,
      [key]: [content.text, s.newChatDrafts[key]].filter(Boolean).join("\n\n"),
    },
  }));
}

export function editOpeningSend(openId: string, id: string) {
  const target = useStore.getState().pendingOpens[openId];
  const send = target && withdrawOpeningSend(openId, id);
  if (send) restoreDraft(target, send);
}

/** Permutes queued follow-ups within their own slots; model choices stay in place. */
export function reorderOpeningSends(openId: string, ids: string[]) {
  update(openId, (target) => {
    const queued = target.queued ?? [];
    const isFollowUp = (op: OpeningOp) =>
      op.kind === "send" && op.delivery === "followUp";
    const rank = new Map(ids.map((id, index) => [id, index]));
    const moved = queued
      .filter(isFollowUp)
      .sort(
        (a, b) =>
          (rank.get(a.id) ?? ids.length) - (rank.get(b.id) ?? ids.length),
      );
    let next = 0;
    return {
      queued: queued.map((op) => (isFollowUp(op) ? (moved[next++] ?? op) : op)),
    };
  });
}
/** Sends a queued follow-up as steering once the chat opens. */
export function steerOpeningSend(openId: string, id: string) {
  update(openId, (target) => ({
    queued: target.queued?.map((op) =>
      op.kind === "send" && op.id === id
        ? { ...op, delivery: "steer" as const, timestamp: Date.now() }
        : op,
    ),
  }));
}
/** Returns unsent messages to the editor ahead of anything typed since. */
export function restoreOpeningSends(openId: string) {
  const pending = useStore.getState().pendingOpens[openId];
  const sends = openingSends(pending);
  if (!pending || !sends.length) return;
  update(openId, (target) => ({
    queued: target.queued?.filter((op) => op.kind !== "send"),
  }));
  for (const send of sends.reverse()) restoreDraft(pending, send);
}
