import { lookup } from "node:dns/promises";
import { get as httpGet } from "node:http";
import { get as httpsGet } from "node:https";
import { BlockList } from "node:net";
import type {
  AssistantImages,
  ImageModel,
  Provider,
  ProviderImages,
} from "@earendil-works/pi-ai";

export const CODEX_IMAGE_API = "pig-codex-images";
export const CODEX_IMAGE_MODEL_IDS = ["gpt-image-2.5", "gpt-image-2"] as const;
const MAX_IMAGE_BYTES = 16 * 1024 * 1024;
const imageError = (code: string) =>
  Object.assign(new Error(code), { errorCode: code });

function codexBaseUrl(baseUrl: string) {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  return /\/codex$/i.test(trimmed) ? trimmed : `${trimmed}/codex`;
}
function imageUrl(baseUrl: string, edit: boolean) {
  const url = new URL(codexBaseUrl(baseUrl));
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw imageError("IMAGE_INVALID_ENDPOINT");
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/images/${edit ? "edits" : "generations"}`;
  return url.href;
}
async function boundedBytes(response: Response, max: number) {
  if (Number(response.headers.get("content-length")) > max) {
    await response.body?.cancel();
    throw imageError("IMAGE_TOO_LARGE");
  }
  if (!response.body) throw imageError("IMAGE_EMPTY_RESPONSE");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > max) throw imageError("IMAGE_TOO_LARGE");
      chunks.push(part.value);
    }
    return Buffer.concat(chunks);
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}
function decodeBase64(data: string) {
  if (data.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4)
    throw imageError("IMAGE_TOO_LARGE");
  if (
    !data.length ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      data,
    )
  )
    throw imageError("IMAGE_INVALID_RESPONSE");
  return Buffer.from(data, "base64");
}
function imageType(data: Buffer) {
  if (data.length > MAX_IMAGE_BYTES) throw imageError("IMAGE_TOO_LARGE");
  if (
    data.length >= 24 &&
    data
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    data.toString("ascii", 12, 16) === "IHDR"
  )
    return "image/png";
  if (
    data.length > 4 &&
    data[0] === 255 &&
    data[1] === 216 &&
    data[2] === 255 &&
    data[data.length - 2] === 255 &&
    data[data.length - 1] === 217
  )
    return "image/jpeg";
  if (
    data.length >= 16 &&
    data.toString("ascii", 0, 4) === "RIFF" &&
    data.toString("ascii", 8, 12) === "WEBP"
  )
    return "image/webp";
  throw imageError("IMAGE_INVALID_CONTENT");
}
// Like PI-Desktop, validate every DNS answer and pin the connection to a
// checked address. Downloads never receive OAuth headers or follow redirects.
const privateAddresses = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 3],
] as const)
  privateAddresses.addSubnet(address, prefix, "ipv4");
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
privateAddresses.addSubnet("2001::", 23, "ipv6");
privateAddresses.addSubnet("2001:db8::", 32, "ipv6");
privateAddresses.addSubnet("2002::", 16, "ipv6");
async function downloadImage(raw: string, signal: AbortSignal) {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw imageError("IMAGE_INVALID_URL");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw imageError("IMAGE_INVALID_URL");
  const answers = await lookup(url.hostname.replace(/^\[|\]$/g, ""), {
    all: true,
  });
  signal.throwIfAborted();
  if (
    !answers.length ||
    answers.some(({ address, family }) =>
      family === 6
        ? !globalV6.check(address, "ipv6") ||
          privateAddresses.check(address, "ipv6")
        : privateAddresses.check(address, "ipv4"),
    )
  )
    throw imageError("IMAGE_UNSAFE_URL");
  const address = answers[0];
  return new Promise<Buffer>((resolve, reject) => {
    const request = (url.protocol === "https:" ? httpsGet : httpGet)(
      url,
      {
        signal,
        agent: false,
        lookup: (_hostname, options, callback) => {
          if (options.all) callback(null, [address]);
          else callback(null, address.address, address.family);
        },
      },
      (response) => {
        if (response.statusCode !== 200) {
          response.destroy();
          reject(imageError("IMAGE_DOWNLOAD_FAILED"));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_IMAGE_BYTES)
            response.destroy(imageError("IMAGE_TOO_LARGE"));
          else chunks.push(chunk);
        });
        response.on("end", () => resolve(Buffer.concat(chunks)));
        response.on("error", reject);
      },
    );
    request.on("error", reject);
  });
}

/** Codex uses JSON for both generation and edits, not OpenAI's multipart API. */
export const codexImages: ProviderImages = {
  async generateImages(model, context, options) {
    const result: AssistantImages = {
      api: model.api,
      provider: model.provider,
      model: model.id,
      output: [],
      stopReason: "stop",
      timestamp: Date.now(),
    };
    try {
      const signal = options?.signal ?? new AbortController().signal;
      signal.throwIfAborted();
      if (model.api !== CODEX_IMAGE_API)
        throw imageError("IMAGE_MODEL_UNAVAILABLE");
      const headers = new Headers({ originator: "pig", ...model.headers });
      if (options?.apiKey)
        headers.set("Authorization", `Bearer ${options.apiKey}`);
      for (const [name, value] of Object.entries(options?.headers ?? {})) {
        if (value === null) headers.delete(name);
        else headers.set(name, value);
      }
      headers.set("Content-Type", "application/json");
      const images = context.input.filter((item) => item.type === "image");
      const body = {
        model: model.id,
        prompt: context.input
          .filter((item) => item.type === "text")
          .map((item) => item.text)
          .join("\n"),
        size: "auto",
        ...(images.length
          ? {
              images: images.map((image) => {
                const bytes = decodeBase64(image.data);
                return {
                  image_url: `data:${imageType(bytes)};base64,${bytes.toString("base64")}`,
                };
              }),
            }
          : {}),
      };
      const response = await (options?.fetch ?? fetch)(
        imageUrl(model.baseUrl, images.length > 0),
        {
          method: "POST",
          headers,
          redirect: "error",
          signal,
          body: JSON.stringify(body),
        },
      );
      await options?.onResponse?.(
        {
          status: response.status,
          headers: Object.fromEntries(response.headers),
        },
        model,
      );
      if (!response.ok) {
        await response.body?.cancel();
        throw imageError(
          response.status === 401 || response.status === 403
            ? "IMAGE_AUTH_FAILED"
            : `IMAGE_HTTP_${response.status}`,
        );
      }
      const raw = await boundedBytes(
        response,
        Math.ceil((MAX_IMAGE_BYTES * 4) / 3) * 10 + 65536,
      );
      let payload: { data?: unknown; usage?: Record<string, unknown> } | null;
      try {
        payload = JSON.parse(raw.toString("utf8"));
      } catch {
        throw imageError("IMAGE_INVALID_RESPONSE");
      }
      const reported = payload?.usage;
      if (reported) {
        const count = (key: string) =>
          typeof reported[key] === "number" && Number.isFinite(reported[key])
            ? Math.max(0, Math.round(reported[key]))
            : 0;
        const input = count("input_tokens") || count("prompt_tokens");
        const output = count("output_tokens") || count("completion_tokens");
        if (input || output || count("total_tokens"))
          result.usage = {
            input,
            output,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: count("total_tokens") || input + output,
            cost: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              total: 0,
            },
          };
      }
      if (
        !Array.isArray(payload?.data) ||
        !payload.data.length ||
        payload.data.length > 10
      )
        throw imageError("IMAGE_INVALID_RESPONSE");
      for (const item of payload.data) {
        if (!item || typeof item !== "object")
          throw imageError("IMAGE_INVALID_RESPONSE");
        if (typeof item.revised_prompt === "string")
          result.output.push({ type: "text", text: item.revised_prompt });
        const bytes =
          typeof item.b64_json === "string"
            ? decodeBase64(item.b64_json)
            : typeof item.url === "string"
              ? await downloadImage(item.url, signal)
              : (() => {
                  throw imageError("IMAGE_INVALID_RESPONSE");
                })();
        result.output.push({
          type: "image",
          data: bytes.toString("base64"),
          mimeType: imageType(bytes),
        });
      }
    } catch (error) {
      result.stopReason = options?.signal?.aborted ? "aborted" : "error";
      result.errorMessage =
        error &&
        typeof error === "object" &&
        "errorCode" in error &&
        typeof error.errorCode === "string" &&
        /^IMAGE_[A-Z0-9_]+$/.test(error.errorCode)
          ? error.errorCode
          : "IMAGE_REQUEST_FAILED";
    }
    return result;
  },
};

export function withCodexImages(provider: Provider): Provider {
  if (provider.id !== "openai-codex" || !provider.auth.oauth) return provider;
  const oauth = provider.auth.oauth;
  const models: ImageModel<typeof CODEX_IMAGE_API>[] =
    CODEX_IMAGE_MODEL_IDS.map((id) => ({
      type: "image",
      id,
      name: id,
      provider: provider.id,
      api: CODEX_IMAGE_API,
      baseUrl: codexBaseUrl(
        provider.baseUrl ?? "https://chatgpt.com/backend-api",
      ),
      input: ["text", "image"],
      output: ["image", "text"],
      cost: { input: NaN, output: NaN, cacheRead: NaN, cacheWrite: NaN },
    }));
  return {
    ...provider,
    // Reuse the provider's OAuth conversion/refresh through Models. pi-ai's
    // private chat header builder extracts the same account id from the JWT;
    // its login/refresh already saves accountId on the canonical credential.
    auth: {
      ...provider.auth,
      oauth: {
        ...oauth,
        async toAuth(credential) {
          const auth = await oauth.toAuth(credential);
          return {
            ...auth,
            headers: {
              ...auth.headers,
              ...(typeof credential.accountId === "string"
                ? { "chatgpt-account-id": credential.accountId }
                : {}),
            },
          };
        },
      },
    },
    getAllModels: () => [
      ...(provider.getAllModels?.() ?? provider.getModels()),
      ...models,
    ],
    filterAllModels: (all, credential) => {
      const filtered = provider.filterAllModels?.(all, credential) ?? all;
      return filtered.filter(
        (model) =>
          model.api !== CODEX_IMAGE_API || credential?.type === "oauth",
      );
    },
    generateImages: (model, context, options) =>
      model.api === CODEX_IMAGE_API
        ? codexImages.generateImages(model, context, options)
        : provider.generateImages
          ? provider.generateImages(model, context, options)
          : codexImages.generateImages(model, context, options),
  };
}
