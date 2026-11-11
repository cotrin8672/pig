import type {
  DraftContent,
  DraftSyncParams,
  DraftSyncResult,
} from "../shared/runtime-contract";
import { sameAddress } from "./chat-snapshot";

export function sameImages(
  a: DraftContent["images"],
  b: DraftContent["images"],
) {
  return (
    a === b ||
    (a.length === b.length &&
      a.every(
        (item, i) =>
          item.id === b[i].id &&
          item.image.mimeType === b[i].image.mimeType &&
          item.image.data === b[i].image.data,
      ))
  );
}

/** Only a background mirror can reuse images from its last acknowledged host revision. */
export function createDraftMirror(
  sync: (input: DraftSyncParams) => Promise<DraftSyncResult>,
) {
  let last:
    | {
        owner: Pick<DraftSyncParams, "hostId" | "sessionId" | "epoch">;
        revision: number;
        images: DraftContent["images"];
      }
    | undefined;
  return async (params: DraftSyncParams) => {
    const { content } = params;
    const reuse =
      !params.requestId &&
      !!content.images.length &&
      last &&
      sameAddress(last.owner, params) &&
      last.revision === params.expectedRevision &&
      sameImages(last.images, content.images);
    const result = await sync(
      reuse
        ? { ...params, keepImages: true, content: { ...content, images: [] } }
        : params,
    );
    if (result.applied && reuse) result.draft.images = content.images;
    const { hostId, sessionId, epoch } = params;
    last = {
      owner: { hostId, sessionId, epoch },
      revision: result.draft.revision,
      images: result.draft.images,
    };
    return result;
  };
}
