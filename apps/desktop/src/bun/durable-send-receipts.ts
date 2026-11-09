import { createHash } from "node:crypto";
import type { Context } from "@earendil-works/chord";
import {
  type Conversation,
  ConversationBusy,
  type ConversationId,
  ConversationIdle,
  defineDocFamily,
  type Harness,
  InboxDoc,
  type SubmissionId,
  type UserInput,
} from "@earendil-works/pi-durable";
import type {
  PromptAccepted,
  PromptParams,
  PromptReceipt,
  SendKey,
} from "../shared/runtime-contract";

export const DURABLE_SEND_LIMITS = {
  textBytes: 1024 * 1024,
  images: 20,
  imageBytes: 20 * 1024 * 1024,
  totalImageBytes: 32 * 1024 * 1024,
} as const;

export type DurableReceiptState = {
  conversationId: ConversationId;
  requestId: string;
  admission?: {
    hash: string;
    submissionId: SubmissionId;
    accepted: PromptAccepted;
    acceptedAt: number;
  };
};

/** Session-owned, NOT a conversation document: native history forks must not copy receipts. */
export const DurableReceiptDoc = defineDocFamily<
  DurableReceiptState,
  { conversationId: ConversationId; requestId: string }
>({
  kind: "pig.send-receipt",
  version: 1,
  scope: "session",
  family: true,
  initial: (seed) => ({ ...seed }),
  checkpointWhen: () => true,
});

export const durableReceiptKey = (
  conversation: Conversation,
  requestId: string,
) => JSON.stringify([conversation.id, requestId]);

type SendInput = PromptParams & { whenBusy?: "followUp" | "steer" | "reject" };
type Attempt = {
  hash: string;
  promise: Promise<PromptAccepted>;
  pending: boolean;
};

function invalid(message: string): never {
  throw new TypeError(`INVALID_PROMPT: ${message}`);
}

function validateKey(key: SendKey): void {
  for (const [name, value, limit] of [
    ["requestId", key.requestId, 256],
    ["hostId", key.hostId, 256],
    ["sessionId", key.sessionId, 1024],
  ] as const) {
    if (typeof value !== "string" || !value.trim() || value.length > limit)
      invalid(name);
  }
  if (!Number.isSafeInteger(key.epoch) || key.epoch < 0) invalid("epoch");
}

/** Buffer.from alone accepts malformed base64 and would alias unrelated requests. */
function imageFingerprint(image: unknown): [string, string, number] {
  if (!image || typeof image !== "object") invalid("image");
  const value = image as { type?: unknown; mimeType?: unknown; data?: unknown };
  if (
    value.type !== "image" ||
    typeof value.mimeType !== "string" ||
    !/^image\/[a-z0-9][a-z0-9.+-]{0,63}$/.test(value.mimeType) ||
    typeof value.data !== "string" ||
    !value.data.length ||
    value.data.length > Math.ceil(DURABLE_SEND_LIMITS.imageBytes / 3) * 4 ||
    value.data.length % 4 === 1 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(value.data)
  )
    invalid("image MIME/base64/size");
  const bytes = Buffer.from(value.data, "base64");
  if (
    !bytes.length ||
    bytes.length > DURABLE_SEND_LIMITS.imageBytes ||
    bytes.toString("base64").replace(/=+$/, "") !==
      value.data.replace(/=+$/, "") ||
    (value.data.includes("=") && value.data.length % 4 !== 0)
  )
    invalid("image base64/size");
  return [
    value.mimeType,
    createHash("sha256").update(bytes).digest("hex"),
    bytes.length,
  ];
}

function checkContent(content: UserInput): void {
  const blocks =
    typeof content === "string" ? [{ type: "text", text: content }] : content;
  if (!Array.isArray(blocks) || blocks.length > DURABLE_SEND_LIMITS.images + 64)
    invalid("native content");
  let textBytes = 0;
  let images = 0;
  let imageBytes = 0;
  for (const block of blocks) {
    if (block?.type === "text" && typeof block.text === "string")
      textBytes += Buffer.byteLength(block.text);
    else if (block?.type === "image") {
      images++;
      imageBytes += imageFingerprint(block)[2];
    } else invalid("native content block");
  }
  if (
    textBytes > DURABLE_SEND_LIMITS.textBytes ||
    images > DURABLE_SEND_LIMITS.images ||
    imageBytes > DURABLE_SEND_LIMITS.totalImageBytes ||
    (!textBytes && !images)
  )
    invalid("native content limits/empty");
}

function prepare(input: SendInput, content?: UserInput) {
  validateKey(input);
  if (!Number.isSafeInteger(input.draftRevision) || input.draftRevision < 0)
    invalid("draftRevision");
  if (
    typeof input.text !== "string" ||
    Buffer.byteLength(input.text) > DURABLE_SEND_LIMITS.textBytes
  )
    invalid("text");
  if (input.images !== undefined && !Array.isArray(input.images))
    invalid("images");
  const images = input.images ?? [];
  if (images.length > DURABLE_SEND_LIMITS.images) invalid("image count");
  const fingerprints = Array.from(images, imageFingerprint);
  if (
    fingerprints.reduce((sum, image) => sum + image[2], 0) >
    DURABLE_SEND_LIMITS.totalImageBytes
  )
    invalid("total image size");
  if (!input.text.trim() && !images.length) invalid("empty prompt");
  const whenBusy = input.whenBusy ?? "followUp";
  if (!["followUp", "steer", "reject"].includes(whenBusy)) invalid("send mode");
  const hash = createHash("sha256")
    .update(
      JSON.stringify([
        input.text,
        fingerprints.map(([mime, digest]) => [mime, digest]),
        whenBusy,
      ]),
    )
    .digest("hex");
  const nativeContent =
    content === undefined
      ? images.length
        ? [{ type: "text" as const, text: input.text }, ...images]
        : input.text
      : content;
  checkContent(nativeContent);
  // Policy-normalized native input is deliberately separate from the original request fingerprint.
  return { hash, content: structuredClone(nativeContent), whenBusy };
}

function checkDocument(
  state: Readonly<DurableReceiptState>,
  conversation: Conversation,
  requestId: string,
): void {
  const a = state.admission;
  if (
    state.conversationId !== conversation.id ||
    state.requestId !== requestId ||
    (a &&
      (!/^[a-f0-9]{64}$/.test(a.hash) ||
        !Number.isSafeInteger(a.submissionId) ||
        a.submissionId <= 0 ||
        !Number.isFinite(a.acceptedAt) ||
        !["started", "queued"].includes(a.accepted?.disposition)))
  )
    throw new Error("INVALID_RECEIPT_DOCUMENT");
}

/** Admission receipts only. No model waits, resend timers, or transport-epoch identity. */
export class DurableSendReceipts {
  private readonly attempts = new Map<string, Attempt>();
  constructor(private readonly harness: Harness) {}

  pending(
    conversation: Conversation,
    key?: Pick<SendKey, "requestId">,
  ): boolean {
    if (key)
      return (
        this.attempts.get(durableReceiptKey(conversation, key.requestId))
          ?.pending ?? false
      );
    const prefix = `[${conversation.id},`;
    return [...this.attempts].some(
      ([id, attempt]) => id.startsWith(prefix) && attempt.pending,
    );
  }

  async send(
    conversation: Conversation,
    input: SendInput,
    ctx: Context,
    content?: UserInput,
  ): Promise<PromptAccepted> {
    const prepared = prepare(input, content);
    const requestId = input.requestId;
    const key = durableReceiptKey(conversation, requestId);
    const previous = this.attempts.get(key);
    if (previous) {
      if (previous.hash !== prepared.hash)
        throw new Error("REQUEST_ID_CONFLICT");
      return structuredClone(await previous.promise);
    }
    const promise = this.harness.commit(async (tx) => {
      const doc = await tx.doc(DurableReceiptDoc, key, {
        conversationId: conversation.id,
        requestId,
      });
      checkDocument(doc, conversation, requestId);
      if (doc.admission) {
        if (doc.admission.hash !== prepared.hash)
          throw new Error("REQUEST_ID_CONFLICT");
        return { disposition: doc.admission.accepted.disposition };
      }
      // Never adopt a native-only request whose payload cannot be verified by the app ledger.
      if (await tx.submissionByRequest(conversation.id, requestId))
        throw new Error("REQUEST_ID_UNVERIFIED");
      // This MUST precede every table write in this commit. Document access is allowed by native 1.5.
      const submissionId = await conversation.submit(tx, {
        type: "input",
        requestId,
        content: prepared.content,
        whenBusy: prepared.whenBusy,
      });
      const inbox = await tx.doc(InboxDoc, conversation.id);
      const accepted: PromptAccepted = {
        disposition: inbox.items.some((item) => item.id === submissionId)
          ? "queued"
          : "started",
      };
      doc.admission = {
        hash: prepared.hash,
        submissionId,
        accepted,
        acceptedAt: Date.now(),
      };
      return accepted;
    }, ctx);
    const attempt: Attempt = { hash: prepared.hash, pending: true, promise };
    this.attempts.set(key, attempt);
    try {
      const accepted = await promise;
      attempt.pending = false;
      return structuredClone(accepted);
    } catch (error) {
      if (
        error instanceof ConversationBusy ||
        error instanceof ConversationIdle ||
        (error instanceof Error &&
          [
            "REQUEST_ID_CONFLICT",
            "REQUEST_ID_UNVERIFIED",
            "INVALID_RECEIPT_DOCUMENT",
          ].includes(error.message))
      ) {
        this.attempts.delete(key);
      }
      // Storage can commit then lose its acknowledgement. Retain indeterminate, NOT a rejected receipt.
      // Repeating this call returns the same failed promise; it never silently re-submits.
      throw error;
    }
  }

  async lookup(
    conversation: Conversation,
    key: SendKey,
    ctx: Context,
  ): Promise<PromptReceipt> {
    validateKey(key);
    const identity = {
      hostId: key.hostId,
      sessionId: key.sessionId,
      epoch: key.epoch,
      requestId: key.requestId,
    };
    const id = durableReceiptKey(conversation, key.requestId);
    let doc: Readonly<DurableReceiptState> | undefined;
    try {
      doc = await this.harness.snapshot(DurableReceiptDoc, id, ctx);
    } catch (error) {
      if (this.attempts.get(id)?.pending)
        return { ...identity, state: "pending" };
      throw error;
    }
    if (doc) checkDocument(doc, conversation, key.requestId);
    if (doc?.admission)
      return {
        ...identity,
        state: "accepted",
        accepted: structuredClone(doc.admission.accepted),
        acceptedAt: doc.admission.acceptedAt,
      };
    return this.attempts.get(id)?.pending
      ? { ...identity, state: "pending" }
      : { ...identity, state: "unknown", reason: "not-found" };
  }
}
