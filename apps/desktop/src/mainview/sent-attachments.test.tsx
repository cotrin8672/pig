import { expect, mock, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";

if (process.env.PIG_ATTACHMENTS_CHILD !== "1") {
  test("sent attachment UI in an isolated process", async () => {
    const child = Bun.spawn(
      [process.execPath, "test", fileURLToPath(import.meta.url)],
      {
        env: { ...process.env, PIG_ATTACHMENTS_CHILD: "1" },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [code, out, error] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect(code, out + error).toBe(0);
  });
} else {
  mock.module("./rpc", () => ({
    rpc: { send: {}, request: {} },
    openChatLink: async () => {},
    regenerate: async () => {},
  }));
  const { UserMessage } = await import("./MessageContent");
  test("sent path attachments render as cards rather than raw text", () => {
    const hash = "a".repeat(64);
    const html = renderToStaticMarkup(
      <UserMessage
        sessionId="s"
        disabled={false}
        message={{
          role: "user",
          timestamp: 0,
          content: `look\n\nC:\\Users\\me\\attachments\\${hash}.png\nC:\\Users\\me\\attachments\\${hash}.pdf`,
        }}
      />,
    );
    expect(html).toContain('class="sent-attachments"');
    expect(html.match(/class="sent-attachment"/g)).toHaveLength(2);
    expect(html).toContain('class="user-bubble">look</div>');
    expect(html).toContain("lucide-image");
    expect(html).toContain("lucide-file-text");
  });
}
