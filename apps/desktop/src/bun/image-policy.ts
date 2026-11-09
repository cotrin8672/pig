import type { JsonValue } from "@earendil-works/chord";
import type { ImageContent } from "@earendil-works/pi-ai";
import {
  defineExtension,
  GenerationTask,
  hook,
  type ToolDiagnostic,
  type ToolExecutionResult,
  type ToolRegistration,
  ToolTask,
  type UserInput,
  wrapTool,
} from "@earendil-works/pi-durable";
import { createNodePhotonImages } from "@earendil-works/pi-durable/images/node";
import {
  DEFAULT_IMAGE_LIMITS,
  type ImageLimits,
  type ImageProcessor,
  type PreparedImage,
} from "@earendil-works/pi-durable/tools";

export const blockedImageNote =
  "[Image removed: images are blocked by settings.]";
export const decodeImageNote =
  "[Image could not be decoded or resized to fit model limits.]";
const boundedNote = "[Value omitted: policy JSON limit.]";
const MAX_JSON_BYTES = 1024 * 1024;
type PolicyJsonLimits = {
  maxBytes?: number;
  maxNodes?: number;
  maxDepth?: number;
  strict?: boolean;
};
const projectionLimits: PolicyJsonLimits = {
  maxBytes: 64 * MAX_JSON_BYTES,
  maxNodes: 500_000,
  maxDepth: 64,
  strict: true,
};
let photon: Promise<ImageProcessor> | undefined;
const defaultProcessor = () => (photon ??= createNodePhotonImages());
function dimensions(image: PreparedImage): string | undefined {
  if (!image.resized) return;
  const { from, to } = image.resized;
  return `Resized from ${from.width}x${from.height} to ${to.width}x${to.height}. Multiply coordinates by ${(from.width / to.width).toFixed(2)} to map them to the original.`;
}

/** Both idle AND queued admission must call this before Conversation.submit().
 * Disabled images return before base64 decode or Photon initialization. */
export async function preparePromptImages(
  images: readonly ImageContent[],
  options: {
    queued?: boolean;
    blockImages: boolean;
    provider?: string;
    modelId?: string;
  },
  limits?: Partial<ImageLimits>,
  processor?: ImageProcessor,
): Promise<{ images: ImageContent[]; hints: string[] }> {
  if (options.blockImages)
    return { images: [], hints: images.map(() => blockedImageNote) };
  const prepared: ImageContent[] = [],
    hints: string[] = [];
  for (const image of images) {
    try {
      // Reject malformed/oversized admission rather than allocate arbitrary decoded buffers.
      if (
        image.data.length > 64 * 1024 * 1024 ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
          image.data,
        )
      )
        throw new Error("Invalid image base64");
      const result = await (processor ?? (await defaultProcessor())).prepare(
        Buffer.from(image.data, "base64"),
        image.mimeType,
        { ...DEFAULT_IMAGE_LIMITS, ...limits },
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
      const hint = dimensions(result);
      if (hint) hints.push(hint);
    } catch {
      hints.push(decodeImageNote);
    }
  }
  return { images: prepared, hints };
}

/** Bounded valid JSON only, for details, results, control values, context and DTOs.
 * No toJSON/getters are executed. This is a data policy, not a trusted-JS sandbox. */
export function sanitizePolicyValue(
  value: unknown,
  blockImages: boolean,
  limits: PolicyJsonLimits = {},
): JsonValue {
  const ancestors = new WeakSet<object>();
  // Native read repeats one prepared image in output AND structuredOutput.
  const maxBytes =
    limits.maxBytes ?? (blockImages ? MAX_JSON_BYTES : 16 * MAX_JSON_BYTES);
  const maxNodes = limits.maxNodes ?? 10_000;
  const omitted = (): string => {
    if (limits.strict) throw new RangeError("Image policy JSON limit exceeded");
    return boundedNote;
  };
  let bytes = 0,
    nodes = 0;
  const visit = (item: unknown, depth: number): JsonValue => {
    if (
      ++nodes > maxNodes ||
      depth > (limits.maxDepth ?? 32) ||
      bytes > maxBytes
    )
      return omitted();
    if (item === null || typeof item === "boolean") return item;
    if (typeof item === "number") return Number.isFinite(item) ? item : null;
    if (typeof item === "string") {
      if (blockImages && /data:image\//i.test(item)) return blockedImageNote;
      const size = Buffer.byteLength(item);
      if (size + bytes > maxBytes) return omitted();
      bytes += size;
      // JSON-bearing details must not smuggle image objects as strings.
      if (blockImages && /^\s*[[{]/.test(item)) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(item);
        } catch {
          return item;
        }
        const clean = JSON.stringify(visit(parsed, depth + 1));
        return clean === JSON.stringify(parsed) ? item : clean;
      }
      return item;
    }
    if (!item || typeof item !== "object") return null;
    if (ancestors.has(item)) return omitted();
    ancestors.add(item);
    try {
      const descriptors = Object.getOwnPropertyDescriptors(item);
      if (
        blockImages &&
        (descriptors.type?.value === "image" ||
          descriptors.type?.value === "image_url" ||
          (typeof descriptors.mimeType?.value === "string" &&
            descriptors.mimeType.value.startsWith("image/")))
      )
        return { type: "text", text: blockedImageNote };
      if (Array.isArray(item)) {
        const result: JsonValue[] = [];
        for (let index = 0; index < item.length; index++) {
          if (nodes >= maxNodes || bytes > maxBytes) {
            result.push(omitted());
            break;
          }
          result.push(visit(descriptors[String(index)]?.value, depth + 1));
        }
        return result;
      }
      const result: Record<string, JsonValue> = {};
      for (const [key, descriptor] of Object.entries(descriptors)) {
        if (nodes >= maxNodes || bytes > maxBytes) {
          omitted();
          break;
        }
        if (
          !descriptor.enumerable ||
          !("value" in descriptor) ||
          key === "__proto__"
        )
          continue;
        bytes += Buffer.byteLength(key) + 8;
        result[key] = visit(descriptor.value, depth + 1);
      }
      return result;
    } finally {
      ancestors.delete(item);
    }
  };
  const result = visit(value, 0);
  // Escaping can increase JSON size. Fail closed, still valid JSON.
  return Buffer.byteLength(JSON.stringify(result)) > maxBytes
    ? omitted()
    : result;
}
export function scrubImages<T>(value: T): T {
  return sanitizePolicyValue(value, true, projectionLimits) as T;
}
export function sanitizeToolResult(
  result: ToolExecutionResult,
  toolName: string,
  blocked: boolean,
): ToolExecutionResult {
  const value = sanitizePolicyValue(result, blocked);
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return { isError: true, output: [{ type: "text", text: boundedNote }] };
  const sanitized = value as ToolExecutionResult;
  // Native read schema is string | ImageContent, NOT TextContent.
  if (
    blocked &&
    toolName === "read" &&
    result.structuredOutput &&
    typeof result.structuredOutput === "object" &&
    !Array.isArray(result.structuredOutput) &&
    result.structuredOutput.type === "image"
  )
    return { ...sanitized, structuredOutput: blockedImageNote };
  return sanitized;
}

export function createNativeImagePolicy(options: {
  blockImages(): boolean;
  processor?: ImageProcessor;
}) {
  const images: ImageProcessor = {
    async prepare(bytes, mimeType, limits) {
      if (options.blockImages()) return undefined;
      return (options.processor ?? (await defaultProcessor())).prepare(
        bytes,
        mimeType,
        limits,
      );
    },
  };
  const wrap = <T extends ToolRegistration>(tool: T): T => ({
    ...tool,
    async execute(args, api, context) {
      const result = await tool.execute(
        args,
        {
          ...api,
          async details(value, detailsContext) {
            await api.details(
              sanitizePolicyValue(value, options.blockImages()),
              detailsContext,
            );
          },
          diagnostic(value) {
            const clean = sanitizePolicyValue(value, options.blockImages());
            api.diagnostic(
              typeof clean === "object" &&
                clean !== null &&
                !Array.isArray(clean)
                ? (clean as ToolDiagnostic)
                : { severity: "warn", message: boundedNote },
            );
          },
        },
        context,
      );
      return sanitizeToolResult(result, tool.name, options.blockImages());
    },
  });
  return {
    images,
    wrap,
    /** DTO defense: apply at every Host/RPC projection, not only model context. */
    project<T>(value: T): T {
      return sanitizePolicyValue(
        value,
        options.blockImages(),
        projectionLimits,
      ) as T;
    },
    async prepareInput(
      content: UserInput,
      limits?: Partial<ImageLimits>,
    ): Promise<UserInput> {
      if (typeof content === "string") return content;
      const output: (typeof content)[number][] = [];
      for (const block of content) {
        if (block.type !== "image") {
          output.push(block);
          continue;
        }
        const normalized = await preparePromptImages(
          [block],
          { blockImages: options.blockImages() },
          limits,
          images,
        );
        output.push(
          ...normalized.images,
          ...normalized.hints.map((text) => ({ type: "text" as const, text })),
        );
      }
      // The policy can change while Photon runs.
      return options.blockImages() ? scrubImages(output) : output;
    },
    /** Mandatory on every effective profile, after third-party wraps/hooks. Does
     * NOT intercept arbitrary third-party api.commit()/appendEntry()/doc writes:
     * native 1.5 exposes no universal pre-storage policy hook. */
    extension(tools: readonly ToolRegistration[]) {
      return defineExtension({
        name: "pig.image-policy",
        wraps: tools.map((tool) => wrapTool(tool, wrap)),
        hooks: [
          hook(ToolTask, {
            afterTool: (call, result) =>
              sanitizeToolResult(result, call.name, options.blockImages()),
          }),
          hook(GenerationTask, {
            beforeRequest: ({ messages }) =>
              options.blockImages()
                ? { messages: scrubImages(messages) }
                : undefined,
          }),
        ],
      });
    },
  };
}
