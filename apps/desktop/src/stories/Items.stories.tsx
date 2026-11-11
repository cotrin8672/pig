import type { Meta } from "@storybook/react-vite";
import { useState } from "react";
import icon from "../../assets/icon.png";
import { AnnotationCard, AnnotationDrafts } from "../mainview/AnnotationCards";
import { AnnotationPopover } from "../mainview/AnnotationPopover";
import { rememberAnnotationRange } from "../mainview/annotation-highlights";
import { CustomRecord } from "../mainview/CustomRecord";
import { ImageGallery } from "../mainview/ImageGallery";
import { LazyDetails } from "../mainview/LazyDetails";
import { Markdown, UserMessage } from "../mainview/MessageContent";
import { ResponseFooter } from "../mainview/ResponseFooter";
import { ThinkingBlock, WorkToggle } from "../mainview/ToolBlock";
import { type DraftAnnotation, withAnnotations } from "../shared/annotations";

export default { title: "Chat/Items" } satisfies Meta;
export const AssistantMarkdown = () => (
  <div className="prose">
    <Markdown
      text={
        '### Findings\n\nThe **greeting** module exports one value:\n\n```ts\nexport const greeting = "Hello, world!";\n```\n\n| Check | Result |\n| --- | --- |\n| Tests | Passed |\n\nInline math: $a^2 + b^2 = c^2$.'
      }
    />
  </div>
);
export const UserTurn = {
  parameters: { role: "user" },
  render: () => (
    <UserMessage
      message={{
        role: "user",
        timestamp: Date.UTC(2026, 0, 1, 12),
        content: "Show me where the greeting is defined.",
      }}
      sessionId="preview"
      disabled={false}
      entryId="example"
    />
  ),
};
export const Thinking = () => (
  <ThinkingBlock
    active={false}
    label="Thinking"
    text="First, look for the **greeting** export."
  />
);
export const ThinkingActive = () => (
  <ThinkingBlock active label="Thinking" text="" />
);
export const SingleImage = () => (
  <ImageGallery sources={[icon]} alt="pig icon" />
);
export const MultipleImages = () => (
  <ImageGallery
    sources={[icon, new URL("../../assets/icon.svg", import.meta.url).href]}
    alt="pig app artwork"
  />
);
export const CustomEntry = () => (
  <CustomRecord
    record={{
      id: "example",
      branchId: "main",
      parentId: null,
      order: 0,
      kind: "custom-entry",
      customType: "review.checkpoint",
      data: { file: "src/greeting.ts", status: "reviewed" },
    }}
  />
);
export const Work = () => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <WorkToggle open={open} tools={1} onToggle={() => setOpen(!open)} />
      {open && <Thinking />}
    </>
  );
};
export const RecordDetails = () => (
  <LazyDetails name="details" summary="Details">
    {() => <pre>{JSON.stringify({ source: "extension" }, null, 2)}</pre>}
  </LazyDetails>
);
const annotated = [
  {
    quote: 'export const greeting = "Hello, world!";',
    comment: "Keep this export name — the docs reference it.",
  },
  {
    quote:
      "The greeting module exports one value, and every caller in the workspace reads it from the barrel file rather than the source module, so renaming the export means touching the barrel too.",
    comment:
      "This sentence is doing too much. Split it, and name the barrel file instead of saying “the barrel”.",
  },
  { quote: "All checks passed.", comment: "" },
];

/** Select any passage of the response above, then comment on it. */
export const Annotations = () => {
  const [annotations, setAnnotations] = useState<DraftAnnotation[]>([]);
  return (
    <>
      <AnnotationPopover
        onAdd={(annotation, range) => {
          const id = crypto.randomUUID();
          rememberAnnotationRange(id, range);
          setAnnotations((current) => [...current, { id, ...annotation }]);
        }}
      />
      <div className="prose">
        <Markdown
          text={
            '### Findings\n\nI traced every import of the greeting across the workspace. Select any passage below and comment on it — the bubble opens above your selection.\n\nThe **greeting** module exports one value:\n\n```ts\nexport const greeting = "Hello, world!";\n```\n\nEvery caller reads it from the barrel file rather than the source module, so renaming the export means touching the barrel too.\n\nAll checks passed.'
          }
        />
      </div>
      <div className="composer">
        <AnnotationDrafts
          annotations={annotations}
          onRemove={(id) =>
            setAnnotations((current) =>
              current.filter((annotation) => annotation.id !== id),
            )
          }
        />
        <p className="composer-hint">
          {annotations.length
            ? `${annotations.length} 件の注釈。カードにカーソルを合わせると本文の対応箇所を強調します。本文のマーカーをクリックするとカードへ移動します。`
            : "本文を範囲選択して注釈をつけてみてください。追加した箇所にはオレンジ色のマーカーが残ります。"}
        </p>
      </div>
    </>
  );
};

/** Quotes clamp to two lines and comments to three; clicking a card shows the rest. */
export const SentAnnotations = {
  parameters: { role: "user" },
  render: () => (
    <ul className="user-annotations">
      {annotated.map(({ quote, comment }) => (
        <AnnotationCard key={quote} quote={quote} comment={comment} />
      ))}
    </ul>
  ),
};

/** A sent message keeps its annotations above the body, parsed back out of the prompt. */
export const UserTurnWithAnnotations = {
  parameters: { role: "user" },
  render: () => (
    <UserMessage
      message={{
        role: "user",
        timestamp: Date.UTC(2026, 0, 1, 12),
        content: withAnnotations(
          "Tightened both passages. Ready for another pass.",
          annotated,
        ),
      }}
      sessionId="preview"
      disabled={false}
      entryId="example"
    />
  ),
};

export const Footer = () => (
  <ResponseFooter
    sessionId="preview"
    canRegenerate={false}
    stats={{
      stopReason: "stop",
      durationMs: 5700,
      endedAt: Date.UTC(2026, 0, 1, 12),
      timestamp: Date.UTC(2026, 0, 1, 12),
      tools: 2,
      totalTokens: 340,
      tokensPerSecond: 42,
      model: "Preview model",
      text: "All checks passed.",
    }}
  />
);
