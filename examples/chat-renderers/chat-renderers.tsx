import {
  type ChatRendererProps,
  defineChatRenderers,
} from "@pig/chat-renderers";
import { useState } from "react";

function LensResult({ data, DefaultRenderer }: ChatRendererProps<"tool">) {
  const [raw, setRaw] = useState(false);
  const result = data.state?.result;
  const details =
    result && typeof result === "object" && "details" in result
      ? result.details
      : result;
  return (
    <section
      style={{
        padding: 12,
        border: "1px solid var(--ds-border-strong)",
        borderRadius: "var(--radius-md)",
      }}
    >
      <strong>{data.call.name}</strong>
      <span>
        {" "}
        · {data.state?.status ?? (data.live ? "running" : "interrupted")}
      </span>
      <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
        {JSON.stringify(details, null, 2) ?? "Waiting for a result…"}
      </pre>
      <button type="button" onClick={() => setRaw(!raw)}>
        {raw ? "Hide standard view" : "Show standard view"}
      </button>
      {raw && <DefaultRenderer />}
    </section>
  );
}

export default defineChatRenderers([
  {
    id: "lens-result",
    kind: "tool",
    // Replace with the exact registered tool name. Package names need not equal tool names.
    match: (data) => data.call.name === "your-lens-tool-name",
    component: LensResult,
  },
]);
