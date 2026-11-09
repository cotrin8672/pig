import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { TranscriptRecord } from "../shared/transcript";
import { customImageSources } from "./custom-data";
import { RecordData } from "./RecordData";

const entry = {
  id: "e",
  entryId: "e",
  parentId: null,
  branchId: "leaf",
  order: 1,
};
test("RND-01 React renders restored/live custom data and details with absent/throwing renderer", () => {
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
    expect(absent).toContain("customDetails");
    expect(absent).toContain(entryId ? "saved" : "live");
    expect(absent).toContain("&lt;script&gt;");
    expect(absent).not.toContain("<script>");
  }
});
test("custom-entry data is not confused with message content and hidden metadata is accessible", () => {
  const record: TranscriptRecord = {
    ...entry,
    kind: "custom-entry",
    customType: "not-a-plan",
    data: { unknownField: ["opaque", 42] },
  };
  const html = renderToStaticMarkup(<RecordData record={record} />);
  expect(html).toContain("unknownField");
  expect(html).toContain("42");
  expect(html).toContain("Raw record");
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
  expect(metadata).toContain("hidden content / metadata");
  expect(metadata).toContain("retained");
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
