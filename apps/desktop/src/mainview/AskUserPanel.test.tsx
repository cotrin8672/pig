import { expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { askQuestions } from "../shared/ask-user";
import type { UIRequest } from "../shared/extension-ui";

mock.module("./rpc", () => ({ rpc: { request: {} } }));
const { AskForm } = await import("./AskUserPanel");

const address = { hostId: "h", sessionId: "s", epoch: 1 };

test("a batch shows one question at a time with a single text field", () => {
  const parsed = askQuestions({
    questions: [
      { question: "First?", options: ["a", "b"] },
      { question: "Second?", options: ["c"] },
    ],
    allowComment: true,
  });
  if (!parsed) throw new Error("not parsed");
  const request: Extract<UIRequest, { kind: "ask" }> = {
    ...address,
    uiId: "u",
    kind: "ask",
    title: "First?",
    questions: parsed.questions,
    allowComment: parsed.allowComment,
  };
  const html = renderToStaticMarkup(<AskForm request={request} />);
  expect(html).toContain("First?");
  expect(html).not.toContain("Second?");
  expect(html).toContain("1/2");
  // Free answer and comment share one field.
  expect(html.match(/<input/g)?.length).toBe(1);
});
