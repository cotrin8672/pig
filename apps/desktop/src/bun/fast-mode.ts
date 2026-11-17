import type { Api, Model } from "@earendil-works/pi-ai";
import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";

/** Only OpenAI Responses APIs read `service_tier`; pi-ai prices "priority". */
export const supportsFastMode = (model: Model<Api> | undefined) =>
  model?.api === "openai-responses" || model?.api === "openai-codex-responses";

export const fastModeExtension =
  (enabled: () => boolean): ExtensionFactory =>
  (pi) => {
    pi.on("before_provider_request", (event, ctx) =>
      enabled() &&
      supportsFastMode(ctx.model) &&
      event.payload &&
      typeof event.payload === "object"
        ? { ...event.payload, service_tier: "priority" }
        : undefined,
    );
  };
