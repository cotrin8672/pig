import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { TranscriptRecord } from "../shared/transcript";
import { customImageSources, isVisibleRecord } from "./custom-data";
import { RecordData } from "./RecordData";

const entry = {
  id: "e",
  entryId: "e",
  parentId: null,
  branchId: "leaf",
  order: 1,
};
test("saved/live messages retain their body but not debug metadata when a renderer is absent or fails", () => {
  for (const entryId of ["saved", undefined]) {
    const record: TranscriptRecord = {
      ...entry,
      entryId,
      kind: "message",
      rendererKey: "unknown",
      message: {
        role: "custom",
        customType: "opaque",
        content: "<script>alert('no')</script>",
        display: true,
        details: { customDetails: "retained" },
        timestamp: 1,
      },
    };
    const absent = renderToStaticMarkup(<RecordData record={record} />);
    const failing = renderToStaticMarkup(
      <RecordData
        record={record}
        renderer={() => {
          throw new Error("renderer failed");
        }}
      />,
    );
    expect(failing).toBe(absent);
    expect(absent).not.toContain("customDetails");
    expect(absent).not.toMatch(/Raw record|Details|>saved<|>live</);
    expect(record.message.role === "custom" && record.message.details).toEqual({
      customDetails: "retained",
    });
    expect(absent).toContain("&lt;script&gt;");
    expect(absent).not.toContain("<script>");
  }
});
test("custom-entry content is retained without exposing raw records or hidden session metadata", () => {
  const record: TranscriptRecord = {
    ...entry,
    kind: "custom-entry",
    customType: "not-a-plan",
    data: { unknownField: ["opaque", 42] },
  };
  const html = renderToStaticMarkup(<RecordData record={record} />);
  expect(html).toContain("unknownField");
  expect(html).toContain("42");
  expect(html).not.toContain("Raw record");
  const metadata = renderToStaticMarkup(
    <RecordData
      record={{
        ...entry,
        kind: "session-entry",
        entryType: "future",
        data: { retained: true },
      }}
    />,
  );
  expect(metadata).toBe("");
});
test("cancelled queued messages are excluded from the conversation without leaving text, attachments or empty cards", () => {
  const record: TranscriptRecord = {
    ...entry,
    id: "recovered:internal-id",
    requestId: "internal-request",
    kind: "message",
    customType: "Cancelled queued prompt",
    message: {
      role: "custom",
      customType: "Cancelled queued prompt",
      display: true,
      timestamp: 1,
      content: [
        { type: "text", text: "楽観的UIの観点も含めて\n<script>" },
        { type: "image", mimeType: "image/png", data: "YWJj" },
      ],
      details: { requestId: "internal-request" },
    },
  };
  for (const entryId of ["saved", undefined]) {
    const message = { ...record, entryId };
    expect(isVisibleRecord(message)).toBe(false);
    expect(
      renderToStaticMarkup(
        <RecordData
          record={message}
          images={<img src="data:image/png;base64,YWJj" alt="" />}
        />,
      ),
    ).toBe("");
  }
});
test("nested custom images use inert approved raster MIME data URLs only", () => {
  const images = customImageSources({
    nested: [
      { type: "image", mimeType: "image/png", data: "YWJj" },
      { type: "image", mimeType: "image/svg+xml", data: "bad" },
      { unknown: "retained" },
    ],
  });
  expect(images).toEqual(["data:image/png;base64,YWJj"]);
});
