import { afterEach, expect, test } from "bun:test";
import type { ChatRenderer } from "@pig/chat-renderers";
import { renderToStaticMarkup } from "react-dom/server";
import { dictionary } from "../shared/i18n";
import { installChatRenderers } from "./chat-renderer-registry";
import { DisclosureScope } from "./LazyDetails";
import { ResponseError } from "./ResponseError";
import { useStore } from "./store";

const initialState = useStore.getInitialState();
const originalSettings = initialState.settings;
afterEach(() => {
  installChatRenderers([]);
  initialState.settings = originalSettings;
});
const message =
  '429 {"type":"error","error":{"type":"rate_limit_error","message":"Please try again later."},"request_id":"req_test"}';

test("explains the reason in both languages; original error is lazy and retained verbatim in details", () => {
  for (const language of ["en", "ja"] as const) {
    initialState.settings = { ...originalSettings, language };
    const html = renderToStaticMarkup(<ResponseError message={message} />);
    const explanation = dictionary(language).responseFailure("rate_limit");
    expect(html).toContain(explanation.title);
    expect(html).toContain(explanation.detail.replaceAll("'", "&#x27;"));
    expect(html).toContain('role="alert"');
    expect(html).not.toContain("req_test");
    expect(html).not.toContain("<pre>");
    const opened = renderToStaticMarkup(
      <DisclosureScope id="error" reveal={1}>
        <ResponseError message={message} />
      </DisclosureScope>,
    );
    expect(opened).toContain("req_test");
    expect(opened).toContain("&quot;rate_limit_error&quot;");
  }
});

test("unknown errors and manual stops have distinct fallback messages", () => {
  initialState.settings = { ...originalSettings, language: "en" };
  expect(
    renderToStaticMarkup(<ResponseError message="Unexpected" />),
  ).toContain("Response stopped: an error occurred");
  const stopped = renderToStaticMarkup(
    <ResponseError message="Request aborted" stopReason="aborted" />,
  );
  expect(stopped).toContain('role="status"');
  expect(stopped).not.toContain("<details");
  expect(stopped).not.toContain("Request aborted");
});

test("error ChatRenderers receive the raw error and can compose the built-in explanation", () => {
  installChatRenderers([
    {
      id: "error-test",
      kind: "error",
      match: (data) => data.message.startsWith("429"),
      component: ({ data, DefaultRenderer }) => (
        <div data-test={data.stopReason}>
          <DefaultRenderer />
        </div>
      ),
    },
  ] satisfies ChatRenderer[]);
  const html = renderToStaticMarkup(
    <ResponseError message={message} stopReason="error" />,
  );
  expect(html).toContain('data-test="error"');
  expect(html).toContain('data-reason="rate_limit"');
});
