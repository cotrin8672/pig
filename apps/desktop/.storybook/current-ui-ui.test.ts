import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { fixtureBrowser, removeFixtureDirectory } from "../scripts/ui-browser";
import { createThemeTokens } from "../src/mainview/dynamic-theme";

test("the actual App and its feature components render in isolated Storybook previews", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pig-current-ui-"));
  const output = join(directory, "storybook");
  const cli = fileURLToPath(
    new URL("../node_modules/storybook/bin/index.cjs", import.meta.url),
  );
  let passed = false;
  try {
    const build = Bun.spawn(
      ["node", cli, "build", "--output-dir", output, "--disable-telemetry"],
      {
        cwd: fileURLToPath(new URL("..", import.meta.url)),
        env: { ...process.env, CI: "true" },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [exit, stdout, stderr] = await Promise.all([
      build.exited,
      new Response(build.stdout).text(),
      new Response(build.stderr).text(),
    ]);
    await Bun.write(join(directory, "build.log"), stdout + stderr);
    expect(exit, (stdout + stderr).slice(-5000)).toBe(0);
    const index = await Bun.file(join(output, "index.json")).json();
    for (const [id, title] of [
      ["current-ui-screen--conversation", "Design System/Screens/App"],
      ["domain-sidebar--default", "Design System/Domain/Sidebar"],
      ["domain-chat-screen--default", "Design System/Domain/ChatScreen"],
      ["domain-composer-ui--default", "Design System/Domain/Composer"],
      ["component-model-picker--default", "Design System/Domain/ModelPicker"],
      [
        "design-system-features-composer-submit--composer-actions",
        "Design System/Domain/ComposerSubmit",
      ],
      ["domain-sidebar--notification-center", "Design System/Domain/Sidebar"],
      ["domain-chat-screen--session-panel", "Design System/Domain/ChatScreen"],
    ])
      expect(index.entries[id]?.title).toBe(title);
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const pathname = new URL(request.url).pathname;
        const path = resolve(
          output,
          `.${pathname === "/" ? "/index.html" : pathname}`,
        );
        if (!path.startsWith(output + sep))
          return new Response(null, { status: 404 });
        const file = Bun.file(path);
        return (await file.exists())
          ? new Response(file)
          : new Response(null, { status: 404 });
      },
    });
    try {
      const url = (id: string, args = "") =>
        `${server.url.href}iframe.html?viewMode=story&id=${id}${args}`;
      const browser = await fixtureBrowser(
        process.env.PIG_UI_BROWSER ??
          "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
        directory,
        url("domain-sidebar--default"),
        { width: 1280, height: 900 },
      );
      try {
        const waitFor = async (expression: string) => {
          for (let attempt = 0; attempt < 300; attempt++) {
            const error = await browser.evaluate<string | null>(
              "document.body.classList.contains('sb-show-errordisplay') ? document.body.innerText : null",
            );
            if (error) throw new Error(error);
            if (await browser.evaluate<boolean>(expression)) return;
            await Bun.sleep(30);
          }
          throw new Error(`Preview did not become ready: ${expression}`);
        };
        const navigate = async (id: string, ready: string, args = "") => {
          await browser.command("Page.navigate", { url: url(id, args) });
          await Bun.sleep(100);
          await waitFor(ready);
        };
        await waitFor("!!document.querySelector('#app-sidebar .project-list')");
        const initialResources = await browser.evaluate<string[]>(
          "performance.getEntriesByType('resource').map(entry=>new URL(entry.name).pathname)",
        );
        expect(
          initialResources.filter((path) =>
            /\/(?:App|DesktopPreview|ChatScreenPreview|ToolBlock|markdown-worker-client|syntax-worker-client)-[^/]+\.js$/.test(
              path,
            ),
          ),
        ).toEqual([]);
        await navigate(
          "settings-remote-pairing--table",
          "document.querySelectorAll('.pairing-table tbody tr').length === 3",
        );
        expect(
          await browser.evaluate(
            "document.querySelectorAll('.pairing-table .thread-more').length",
          ),
        ).toBe(0);
        const remove =
          ".pairing-table .mac-remove[aria-description='研究室PC']";
        await browser.evaluate(`document.querySelector("${remove}").click()`);
        await waitFor(
          `!!document.querySelector("${remove}.armed") && document.querySelectorAll('.pairing-table tbody tr').length === 3`,
        );
        await browser.evaluate(`document.querySelector("${remove}").click()`);
        await waitFor(`!document.querySelector("${remove}")`);
        await browser.evaluate(
          "[...document.querySelectorAll('.table-toolbar button')].find(button => button.textContent === 'PCに接続…').click()",
        );
        const connect = "dialog[open][aria-labelledby]";
        await waitFor(
          `document.querySelectorAll('${connect} .mac-connect-segments span:not([data-current],[data-done])').length === 4`,
        );
        await browser.evaluate(
          `document.querySelector('${connect} input').focus()`,
        );
        await browser.command("Input.insertText", { text: "demo" });
        await browser.evaluate(
          `document.querySelector('${connect} button[type=submit]').click()`,
        );
        await waitFor(
          `!!document.querySelector('${connect} .mac-connect-segments [data-current=error]')`,
        );
        await browser.evaluate(`(() => {
          const input = document.querySelector('${connect} input');
          input.select();
          input.focus();
        })()`);
        await browser.command("Input.insertText", { text: "pig-pair:1:demo" });
        await browser.evaluate(
          `document.querySelector('${connect} button[type=submit]').click()`,
        );
        await waitFor(
          `document.querySelectorAll('${connect} .mac-connect-segments [data-done]').length === 4`,
        );
        await browser.command("Emulation.setDeviceMetricsOverride", {
          width: 390,
          height: 480,
          deviceScaleFactor: 1,
          mobile: false,
        });
        await navigate(
          "settings-remote-pairing--invite-dialog",
          "!!document.querySelector('dialog[open] .mac-invite-status')",
        );
        const fitsDialog = `(() => {
          const panel = document.querySelector('dialog[open]');
          const footer = panel.querySelector('.dialog-actions').getBoundingClientRect();
          return panel.scrollHeight <= panel.clientHeight + 1 && panel.scrollWidth <= panel.clientWidth + 1
            && footer.bottom <= innerHeight;
        })()`;
        expect(await browser.evaluate(fitsDialog), "invite fits").toBe(true);
        const inviteStatus = "dialog[open] .mac-invite-status[role=status]";
        expect(
          await browser.evaluate(
            `document.querySelector('${inviteStatus}').textContent`,
          ),
        ).toContain("招待の準備ができました");
        await browser.evaluate(
          "document.querySelector('dialog[open] [aria-label=\"招待コードをコピー\"]').click()",
        );
        await waitFor(
          `document.querySelector('${inviteStatus}').textContent.includes('待っています')`,
        );
        await waitFor(
          `document.querySelector('${inviteStatus}').textContent.includes('を追加しました') && !document.querySelector('dialog[open] .mac-invite-code-line code')`,
        );
        expect(
          await browser.evaluate(fitsDialog),
          "completed invite fits without scrolling",
        ).toBe(true);
        await browser.command("Emulation.clearDeviceMetricsOverride", {});
        await navigate(
          "prototypes-desktop-motion--playground",
          "!!document.querySelector('.desktop-motion-stage .model-picker')",
        );
        const media = (value: string) =>
          browser.command("Emulation.setEmulatedMedia", {
            features: [{ name: "prefers-reduced-motion", value }],
          });
        await media("no-preference");
        // Compare painted geometry at mirrored points in the two timelines.
        async function trajectory(
          trigger: string,
          surface: string,
          entering: boolean,
        ) {
          return browser.evaluate<number[][]>(`(async () => {
            const d = selector => document.querySelector(selector);
            d('${trigger}').click();
            const end = performance.now() + 2200;
            do {
              await new Promise(requestAnimationFrame);
              const node = d('${surface}');
              const animation = node?.getAnimations().find(a =>
                ['desktop-motion-shift','desktop-motion-gather'].includes(a.animationName));
              if (!animation || !node.checkVisibility()) continue;
              animation.pause();
              const {duration,delay} = animation.effect.getTiming();
              const samples = [0.02, 0.3, 0.6, 0.98].map(p => {
                const forward = ${entering} || animation.playbackRate < 0;
                animation.currentTime = delay + duration * (forward ? p : 1-p);
                const {x,y,width} = node.getBoundingClientRect();
                return [x,y,width,Number(getComputedStyle(node).opacity)];
              });
              animation.finish();
              return samples;
            } while (performance.now() < end);
            throw Error('No visible transform on ${surface}');
          })()`);
        }
        await browser.command("Animation.setPlaybackRate", {
          playbackRate: 0.4,
        });
        for (const spring of [false, true]) {
          if (spring)
            await browser.evaluate(
              "document.querySelector('.desktop-motion-guide button:last-child').click()",
            );
          for (const [trigger, panel, close] of [
            [
              ".sidebar-icon",
              ".settings-page .content-page-shell",
              ".back-button",
            ],
            [".notification-bell", ".notification-panel", ".notification-bell"],
            [".model-picker summary", ".model-panel", ".model-picker summary"],
          ]) {
            const opening = await trajectory(trigger, panel, true);
            // Let the staggered notification rows and native details settle.
            if (panel === ".notification-panel") await Bun.sleep(950);
            const closing = await trajectory(close, panel, false);
            const axis = panel.includes("page") ? 0 : 2;
            expect(
              Math.abs(opening[0][axis] - opening[3][axis]),
            ).toBeGreaterThan(3);
            for (let i = 0; i < opening.length; i++) {
              expect(opening[i][3]).toBe(1);
              expect(closing[i][3]).toBe(1);
              for (const k of [0, 1, 2])
                expect(Math.abs(opening[i][k] - closing[i][k])).toBeLessThan(
                  0.25,
                );
            }
            if (spring)
              expect(
                (opening[2][axis] - opening[3][axis]) * (axis === 0 ? -1 : 1),
              ).toBeGreaterThan(0.1);
          }
        }
        await browser.command("Animation.setPlaybackRate", { playbackRate: 1 });
        await media("reduce");
        await browser.evaluate(
          "document.querySelector('.model-picker summary').click()",
        );
        await waitFor("!!document.querySelector('.model-panel')");
        const noPreviewMotion =
          "!getComputedStyle(document.querySelector('.model-panel')).animationName.includes('desktop-motion')";
        await waitFor(noPreviewMotion);
        await browser.evaluate(
          "document.querySelector('.model-picker summary').click()",
        );
        await waitFor("!document.querySelector('.model-panel')");
        await media("no-preference");
        await browser.evaluate(
          "document.querySelector('.desktop-motion-guide button').click()",
        );
        await browser.evaluate(
          "document.querySelector('.model-picker summary').click()",
        );
        await waitFor("!!document.querySelector('.model-panel')");
        expect(await browser.evaluate(noPreviewMotion)).toBe(true);
        await browser.command("Emulation.setEmulatedMedia", { features: [] });
        for (const scene of [
          "conversation",
          "running",
          "approval",
          "empty",
          "settings",
          "split",
        ]) {
          await navigate(
            `current-ui-screen--${scene}`,
            scene === "settings"
              ? "!!document.querySelector('.settings-page')"
              : "!!document.querySelector('form.composer')",
          );
          expect(
            await browser.evaluate(
              "document.querySelectorAll('.app-shell').length",
            ),
          ).toBe(1);
          expect(
            await browser.evaluate("!!document.querySelector('#app-sidebar')"),
          ).toBe(true);
          if (scene === "split")
            expect(
              await browser.evaluate(
                "document.querySelectorAll('form.composer').length",
              ),
            ).toBe(2);
          if (scene === "running")
            expect(
              await browser.evaluate(
                "!!document.querySelector('.session-panel')",
              ),
            ).toBe(true);
          if (scene === "approval")
            expect(
              await browser.evaluate(
                "!!document.querySelector('dialog[open]')",
              ),
            ).toBe(true);
          if (scene === "empty")
            expect(
              await browser.evaluate("!!document.querySelector('.chat-empty')"),
            ).toBe(true);
          if (scene === "conversation" || scene === "split")
            await Bun.write(
              join(directory, `${scene}.png`),
              await browser.screenshot(),
            );
        }
        await navigate(
          "current-ui-screen--settings",
          "!!document.querySelector('.settings-page')",
          "&args=themeColor:!hex(ff6600);language:en",
        );
        expect(
          await browser.evaluate(
            "getComputedStyle(document.documentElement).getPropertyValue('--ds-accent').trim()",
          ),
        ).toBe(createThemeTokens("#ff6600")["--ds-accent"]);
        expect(await browser.evaluate("document.documentElement.lang")).toBe(
          "en",
        );
        for (const [id, ready] of [
          [
            "domain-sidebar--default",
            "!!document.querySelector('#app-sidebar .project-list')",
          ],
          [
            "domain-chat-screen--default",
            "!!document.querySelector('.response-turn')",
          ],
          [
            "domain-composer-ui--default",
            `document.querySelectorAll('form.composer').length === 4 &&
             [...document.querySelectorAll('.current-ui-composer-story-state')].every(section => {
               const dock = section.querySelector('.composer-dock').getBoundingClientRect();
               return dock.height > 0 && dock.top >= section.querySelector('h3').getBoundingClientRect().bottom
                 && dock.bottom <= section.getBoundingClientRect().bottom + 1;
             }) &&
             !!document.querySelector('[aria-label="空入力・送信不可"] button[type=submit]:disabled') &&
             !!document.querySelector('[aria-label="入力済み・送信可能"] button[type=submit]:enabled') &&
             !!document.querySelector('[aria-label="応答中"] [aria-keyshortcuts=Escape]') &&
             document.querySelector('[aria-label="キューあり"] .message-queue')?.textContent.includes('次にテスト結果を確認して')`,
          ],
        ]) {
          await navigate(id, ready);
          if (id === "domain-sidebar--default") {
            expect(
              await browser.evaluate(
                "!!document.querySelector('.provider-usage-card')",
              ),
            ).toBe(true);
            expect(
              await browser.evaluate(
                "!!document.querySelector('.notification-center')",
              ),
            ).toBe(true);
            expect(
              await browser.evaluate(
                "!!document.querySelector('form.composer')",
              ),
            ).toBe(false);
          } else {
            expect(
              await browser.evaluate(
                "!!document.querySelector('#app-sidebar')",
              ),
            ).toBe(false);
          }
          if (id === "domain-composer-ui--default")
            expect(
              await browser.evaluate(
                "!!document.querySelector('.response-turn')",
              ),
            ).toBe(false);
        }
        await navigate(
          "component-model-picker--default",
          "!!document.querySelector('.current-ui-unit .model-picker')",
        );
        await browser.evaluate(
          "document.querySelector('.model-picker summary').click()",
        );
        await waitFor("!!document.querySelector('.model-source-rail')");
        await browser.evaluate(
          "[...document.querySelectorAll('.model-source-rail button')].find(button=>button.getAttribute('aria-label')==='OpenAI Codex').click()",
        );
        await waitFor(
          "[...document.querySelectorAll('.model-option')].some(button=>button.textContent.includes('GPT-6.1 Sol'))",
        );
        await browser.evaluate(
          "[...document.querySelectorAll('.model-option')].find(button=>button.textContent.includes('GPT-6.1 Sol')).click()",
        );
        await waitFor(
          "document.querySelector('.picker-model-label').textContent==='GPT-6.1 Sol'",
        );
        for (const size of ["narrow", "small"]) {
          await browser.evaluate(`(() => {
            const select = document.querySelector('.current-ui-unit select');
            select.value = '${size === "small" ? 280 : 380}';
            select.dispatchEvent(new Event('change', { bubbles: true }));
          })()`);
          await waitFor(
            `document.querySelector('.pane-view')?.clientWidth === ${size === "small" ? 280 : 380} && !!document.querySelector('.model-source-rail')`,
          );
          expect(
            await browser.evaluate(`(() => {
              const pane = document.querySelector('.pane-view').getBoundingClientRect();
              const panel = document.querySelector('.model-panel').getBoundingClientRect();
              const label = document.querySelector('.model-source-rail button > span');
              return panel.left >= pane.left && panel.right <= pane.right
                && getComputedStyle(label).display === 'none';
            })()`),
          ).toBe(true);
          expect(
            await browser.evaluate(
              "getComputedStyle(document.querySelector('.model-capabilities')).display === 'none'",
            ),
          ).toBe(size === "small");
          await browser.evaluate(
            "document.querySelector('.model-source-rail button').dispatchEvent(new PointerEvent('pointerover', {bubbles:true}))",
          );
          await waitFor("!!document.querySelector('[role=tooltip]')");
          await Bun.write(
            join(directory, `model-picker-${size}.png`),
            await browser.screenshot(),
          );
        }
        await navigate(
          "domain-sidebar--notification-center",
          "!!document.querySelector('.notification-center')",
        );
        await browser.evaluate(
          "document.querySelector('.notification-center summary').click()",
        );
        await waitFor("document.querySelector('.notification-center').open");
        expect(
          await browser.evaluate(
            "document.querySelectorAll('.notification-entry').length",
          ),
        ).toBe(3);
        await browser.evaluate(
          "document.querySelectorAll('.notification-filters button')[1].click()",
        );
        await waitFor(
          "document.querySelectorAll('.notification-entry').length===2",
        );
        await browser.evaluate(
          "document.querySelectorAll('.notification-heading button')[0].click()",
        );
        await waitFor("!document.querySelector('.notification-badge')");
        await browser.evaluate(
          "document.querySelectorAll('.notification-heading button')[1].click()",
        );
        await waitFor("!document.querySelector('.notification-entry')");
        await navigate(
          "domain-chat-screen--session-panel",
          "!!document.querySelector('.session-panel')",
        );
        await browser.evaluate(
          "const chip=document.querySelector('.session-activity [data-tab=\"tasks\"]');if(chip.getAttribute('aria-expanded')==='false')chip.click()",
        );
        await waitFor(
          "document.querySelector('.session-panel').matches(':popover-open')",
        );
        await waitFor("!!document.querySelector('.session-task-main')");
        await browser.evaluate(
          "document.querySelector('.session-task-main').click()",
        );
        await waitFor("!!document.querySelector('.session-task-output pre')");
        await navigate(
          "current-ui-screen--conversation",
          "!!document.querySelector('form.composer')",
        );
        expect(
          await browser.evaluate(
            "document.querySelector('.picker-model-label').textContent",
          ),
        ).toBe("Claude Opus 5.5");
        expect(
          await browser.evaluate(
            "document.querySelector('.notification-badge').textContent",
          ),
        ).toBe("2");
        await browser.evaluate(
          "document.querySelector('form.composer textarea').focus()",
        );
        await browser.command("Input.insertText", {
          text: "Storybookだけの下書き",
        });
        await waitFor(
          "!document.querySelector('form.composer button[type=\"submit\"]').disabled",
        );
        await browser.evaluate(
          "document.querySelector('form.composer button[type=\"submit\"]').click()",
        );
        await waitFor(
          "document.body.innerText.includes('Storybookの表示用プレビューです')",
        );
        expect(
          await browser.evaluate(
            "document.querySelector('form.composer textarea').value",
          ),
        ).toBe("Storybookだけの下書き");
        await browser.evaluate(
          "document.querySelector('#app-sidebar .sidebar-icon').click()",
        );
        await waitFor("!!document.querySelector('.settings-page')");
        passed = true;
      } finally {
        await browser.close();
      }
    } finally {
      server.stop(true);
    }
  } finally {
    if (passed) await removeFixtureDirectory(directory);
    else console.error(`Current UI preview fixture retained: ${directory}`);
  }
}, 180_000);
