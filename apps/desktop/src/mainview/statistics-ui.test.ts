import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { build } from "vite";
import {
  fixtureBrowser,
  removeFixtureDirectory,
} from "../../scripts/ui-browser";

const edge =
  process.env.PIG_UI_BROWSER ??
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
test.skipIf(!existsSync(edge) && !process.env.PIG_REQUIRE_UI_TESTS)(
  "statistics: production navigation, one-screen pastel layout, live periods, errors and stale replies",
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "pig-statistics-ui-"));
    let passed = false;
    const source = (path: string) =>
      JSON.stringify(fileURLToPath(new URL(path, import.meta.url)));
    try {
      await Bun.write(
        join(dir, "fixture.tsx"),
        `
        import {createRoot} from ${JSON.stringify(fileURLToPath(import.meta.resolve("react-dom/client")))};
        import {App} from ${source("./App.tsx")};
        import {useStore} from ${source("./store.ts")};
        import {navigate} from ${source("./navigation.ts")};
        import {rpc} from ${source("../stories/browser-rpc.ts")};
        import {installPreview,previewDefaults} from ${source("../stories/current-ui/fixtures.ts")};
        import {statisticsFixture,emptyStatistics} from ${source("../stories/statistics/statistics-data.ts")};
        import ${source("./styles.css")};
        installPreview(previewDefaults);
        window.fixture = {useStore,navigate};
        rpc.request.statistics = async ({period}) => {
          if(period === 'all') throw Error('SECRET must not escape');
          await new Promise(resolve => setTimeout(resolve,period === 'today' ? 200 : 20));
          if(period === 'today') return emptyStatistics;
          return statisticsFixture;
        };
        createRoot(document.getElementById('root')).render(<App/>);
      `,
      );
      await Bun.write(
        join(dir, "index.html"),
        '<html><body style="margin:0"><script>window.uiErrors=[];addEventListener("error",e=>window.uiErrors.push(e.message));</script><div id="root"></div><script type="module" src="./fixture.tsx"></script></body></html>',
      );
      const out = join(dir, "dist");
      await build({
        configFile: false,
        root: dir,
        base: "/",
        logLevel: "silent",
        plugins: [tailwindcss()],
        esbuild: { jsx: "automatic" },
        resolve: {
          alias: [
            {
              find: /^\.\/rpc$/,
              replacement: fileURLToPath(
                new URL("../stories/browser-rpc.ts", import.meta.url),
              ),
            },
            {
              find: "react/jsx-runtime",
              replacement: fileURLToPath(
                import.meta.resolve("react/jsx-runtime"),
              ),
            },
            {
              find: "react/jsx-dev-runtime",
              replacement: fileURLToPath(
                import.meta.resolve("react/jsx-dev-runtime"),
              ),
            },
          ],
        },
        build: { outDir: out },
      });
      const server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        fetch(request) {
          const path = new URL(request.url).pathname;
          if (!/^\/(?:assets\/[\w.-]+|index\.html)?$/.test(path))
            return new Response(null, { status: 404 });
          return new Response(
            Bun.file(join(out, path === "/" ? "index.html" : path.slice(1))),
          );
        },
      });
      try {
        const browser = await fixtureBrowser(edge, dir, server.url.href, {
          width: 1100,
          height: 720,
        });
        try {
          const waitFor = async (expression: string) => {
            for (let i = 0; i < 200; i++) {
              if (await browser.evaluate<boolean>(expression)) return;
              await Bun.sleep(30);
            }
            await Bun.write(
              join(dir, "failure.png"),
              await browser.screenshot(),
            );
            const debug = await browser.evaluate<string>(
              "JSON.stringify({errors:window.uiErrors,body:document.body.innerText.slice(0,600),state:window.fixture?.useStore.getState().page})",
            );
            throw new Error(`UI did not become ready: ${expression}: ${debug}`);
          };
          await waitFor(
            "!!document.querySelector('.sidebar-footer button[aria-label=\"統計\"]')",
          );
          await browser.evaluate(
            `document.querySelector('.sidebar-footer button[aria-label="統計"]').click()`,
          );
          await waitFor(
            "document.querySelector('.stats-models')?.textContent.includes('Claude Opus')",
          );
          const layout = await browser.evaluate<{
            scroll: boolean;
            cards: boolean;
            tokenColumns: number;
            colors: number;
          }>(`(() => {
            const page=document.querySelector('.statistics-page');
            const cards=[...page.querySelectorAll('[data-ui-surface="card"]')];
            const visible=cards.every(el=>{const r=el.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight});
            const glass=cards.every(el=>{const c=getComputedStyle(el);return c.opacity==='1'&&c.backgroundColor.startsWith('rgba(')});
            const model=document.querySelector('.stats-models .stats-scroll');
            const colors=new Set([...page.querySelectorAll('.stats-stack span')].map(el=>getComputedStyle(el).backgroundColor));
            return {scroll:page.scrollHeight>page.clientHeight+1,cards:visible&&glass&&model.scrollWidth<=model.clientWidth+1,tokenColumns:page.querySelectorAll('.stats-summary > div').length,colors:colors.size};
          })()`);
          expect(layout).toMatchObject({
            scroll: false,
            cards: true,
            tokenColumns: 6,
            colors: 3,
          });
          await Bun.write(
            join(dir, "statistics.png"),
            await browser.screenshot(),
          );
          const point = await browser.evaluate<{ x: number; y: number }>(
            `(() => {const r=document.querySelector('.stats-bar-area').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+20}})()`,
          );
          await browser.command("Input.dispatchMouseEvent", {
            type: "mouseMoved",
            ...point,
          });
          await waitFor(
            "document.querySelectorAll('.stats-tip:popover-open').length===1",
          );
          await browser.command("Input.dispatchKeyEvent", {
            type: "keyDown",
            key: "Escape",
            code: "Escape",
          });
          await waitFor("!document.querySelector('.stats-tip:popover-open')");
          await browser.evaluate(`(() => {
            const buttons=[...document.querySelectorAll('.stats-periods button')];
            buttons[0].click();buttons[2].click();
          })()`);
          await Bun.sleep(300);
          expect(
            await browser.evaluate<boolean>(
              "document.querySelector('.stats-models').textContent.includes('Claude Opus')",
            ),
          ).toBe(true);
          await browser.evaluate(
            "document.querySelectorAll('.stats-periods button')[3].click()",
          );
          await waitFor(
            "document.querySelector('.stats-header').textContent.includes('統計を取得できませんでした')",
          );
          expect(
            await browser.evaluate<boolean>(
              "document.body.textContent.includes('SECRET')",
            ),
          ).toBe(false);
          await browser.evaluate(
            "window.fixture.useStore.setState(s=>({settings:{...s.settings,language:'en'}})); window.fixture.navigate('statistics')",
          );
          await waitFor(
            "document.querySelector('.stats-header h1')?.textContent==='Statistics'",
          );
          await browser.evaluate(
            `document.querySelector('.sidebar-footer button[aria-label="Statistics"]').click()`,
          );
          expect(
            await browser.evaluate<string>(
              "window.fixture.useStore.getState().page",
            ),
          ).toBe("chat");
          expect(
            await browser.evaluate<boolean>(
              "!!document.querySelector('.statistics-page')",
            ),
          ).toBe(false);
          passed = true;
        } finally {
          await browser.close();
        }
      } finally {
        server.stop(true);
      }
    } finally {
      if (passed && process.env.PIG_KEEP_UI_FIXTURE !== "1")
        await removeFixtureDirectory(dir);
      else console.log(`Statistics UI fixture: ${dir}`);
    }
  },
  90_000,
);
