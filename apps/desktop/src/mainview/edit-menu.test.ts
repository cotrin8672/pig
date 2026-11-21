import { expect, test } from "bun:test";
import { editMenuRequest } from "./edit-menu";

const base = { editable: false, readOnly: false, selection: "", copied: "" };

test("plain page areas get no menu at all", () => {
  expect(editMenuRequest(base)).toBeUndefined();
});

test("text fields always offer the edit commands; cut/copy need a selection", () => {
  expect(editMenuRequest({ ...base, editable: true })).toEqual({
    items: ["cut", "copy", "paste", "separator", "selectAll"],
    disabled: ["cut", "copy"],
  });
  expect(
    editMenuRequest({
      ...base,
      editable: true,
      selection: "a",
      copied: "unfolded a",
    }),
  ).toEqual({
    items: ["cut", "copy", "paste", "separator", "selectAll"],
    text: "unfolded a",
  });
  expect(
    editMenuRequest({
      ...base,
      editable: true,
      readOnly: true,
      selection: "a",
      copied: "a",
    })?.disabled,
  ).toEqual(["cut", "paste"]);
});

test("links open in the browser or copy; a selection adds Copy", () => {
  expect(
    editMenuRequest({
      ...base,
      selection: "docs",
      copied: "docs",
      url: "https://example.com",
    }),
  ).toEqual({
    items: ["openLink", "copyLink", "separator", "copy"],
    text: "docs",
    url: "https://example.com",
  });
});
