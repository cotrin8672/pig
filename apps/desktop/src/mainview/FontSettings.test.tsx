import { expect, mock, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";

if (process.env.PIG_FONT_SETTINGS_CHILD !== "1") {
  test("font settings layout in an isolated renderer", async () => {
    const child = Bun.spawn(
      [process.execPath, "test", fileURLToPath(import.meta.url)],
      {
        env: { ...process.env, PIG_FONT_SETTINGS_CHILD: "1" },
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
    rpc: { request: { listFontFamilies: () => new Promise(() => {}) } },
    updateSettings: () => {},
  }));
  const { FontSettings } = await import("./FontSettings");
  test("font loading never adds a status row or replaces saved font labels", () => {
    const html = renderToStaticMarkup(<FontSettings />);
    expect(html.match(/class="settings-row"/g)).toHaveLength(2);
    expect(html.match(/class="picker font-picker"/g)).toHaveLength(2);
    expect(html).not.toContain("Loading");
    expect(html).not.toContain("font-settings-status");
    expect(html).toContain("Interface font: System default");
    expect(html).toContain("Code font: System default");
  });
}
