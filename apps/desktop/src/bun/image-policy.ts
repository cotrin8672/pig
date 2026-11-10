import { createHash } from "node:crypto";
import type { Api, ImageContent, Model } from "@earendil-works/pi-ai";
import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { formatDimensionNote, resizeImage } from "./sdk";

export const blockedImageNote =
  "[Image removed: images are blocked by settings.]";
export const decodeImageNote =
  "[Image could not be decoded or resized to fit model limits.]";
export async function preparePromptImages(
  images: ImageContent[],
  options: {
    queued: boolean;
    blockImages: boolean;
    provider: string;
    modelId: string;
  },
  // Captured from this session's model, never a process-global provider/id map.
  resizeOptions?: Parameters<typeof resizeImage>[2],
): Promise<{ images: ImageContent[]; hints: string[] }> {
  if (options.blockImages)
    return { images: [], hints: images.map(() => blockedImageNote) };
  // SDK idle prompt owns normalization. Its followUp path explicitly bypasses it.
  if (!options.queued) return { images, hints: [] };
  const prepared: ImageContent[] = [],
    hints: string[] = [];
  for (const image of images) {
    try {
      const result = await resizeImage(
        Buffer.from(image.data, "base64"),
        image.mimeType,
        resizeOptions,
      );
      if (!result) {
        hints.push(decodeImageNote);
        continue;
      }
      prepared.push({
        type: "image",
        data: result.data,
        mimeType: result.mimeType,
      });
      const hint = formatDimensionNote(result);
      if (hint) hints.push(hint);
    } catch {
      hints.push(decodeImageNote);
    }
  }
  return { images: prepared, hints };
}
/** JSON-only projection/persistence/context scrub, including custom and tool details. */
export function scrubImages<T>(value: T): T {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(scrubImages) as T;
  if ("type" in value && value.type === "image")
    return { type: "text", text: blockedImageNote } as T;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, scrubImages(item)]),
  ) as T;
}

/** Runs after discovered extension input handlers. Recognize host-normalized
 * queue images so they are not resized a second time, but normalize newly
 * inserted extension images against this session's actual model. */
export function createQueuedImagePolicy(options: {
  blockImages(): boolean;
  processing(): void;
  queued(): void;
  settled(): void;
}) {
  const prepared = new Set<string>();
  const key = (image: ImageContent, model: Model<Api> | undefined) =>
    createHash("sha256")
      .update(
        JSON.stringify([
          model?.provider,
          model?.id,
          model?.inputLimits?.images,
          image.mimeType,
          image.data,
        ]),
      )
      .digest("hex");
  const remember = (images: ImageContent[], model: Model<Api> | undefined) => {
    for (const image of images) prepared.add(key(image, model));
  };
  const extension: ExtensionFactory = (pi) => {
    pi.on("input", async (event, ctx) => {
      if (!event.images?.length) return { action: "continue" };
      const blocked = options.blockImages(),
        queued = !ctx.isIdle();
      if (!blocked && !queued) return { action: "continue" };
      options.processing();
      const images: ImageContent[] = [],
        hints: string[] = [];
      for (const image of event.images) {
        if (!blocked && prepared.has(key(image, ctx.model))) {
          images.push(image);
          continue;
        }
        const result = await preparePromptImages(
          [image],
          {
            queued,
            blockImages: blocked,
            provider: ctx.model?.provider ?? "",
            modelId: ctx.model?.id ?? "",
          },
          ctx.model?.inputLimits?.images?.resize,
        );
        images.push(...result.images);
        hints.push(...result.hints);
        remember(result.images, ctx.model);
      }
      if (queued && images.length) options.queued();
      return {
        action: "transform",
        text: [event.text, ...hints].filter(Boolean).join("\n\n"),
        images,
      };
    });
    pi.on("context_with_system", (event) =>
      options.blockImages()
        ? { messages: scrubImages(event.messages) }
        : undefined,
    );
    pi.on("tool_result", (event) =>
      options.blockImages()
        ? {
            content: scrubImages(event.content),
            details: scrubImages(event.details),
          }
        : undefined,
    );
    pi.on("agent_settled", () => {
      prepared.clear();
      options.settled();
    });
  };
  return { remember, extension };
}
