import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, realpath } from "node:fs/promises";
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
    // Vite's root must be the long path: CI's tmpdir() is an 8.3 short name.
    const dir = await realpath(
      await mkdtemp(join(tmpdir(), "pig-statistics-ui-")),
    );
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
        import {receiveStatisticsProgress} from ${source("./statistics-progress.ts")};
        import {installPreview,previewDefaults} from ${source("../stories/current-ui/fixtures.ts")};
        import {statisticsFixture,emptyStatistics} from ${source("../stories/statistics/statistics-data.ts")};
        import ${source("./styles.css")};
        installPreview(previewDefaults);
        window.fixture = {useStore,navigate};
        rpc.request.listFontFamilies = async () => [];
        rpc.request.listInstalled = async () => [];
        rpc.request.searchPackages = async () => ({items:[],total:0});
        let first = true;
        rpc.request.statistics = async ({period, requestId}) => {
          if(period === 'all') throw Error('SECRET must not escape');
          if (first) {
            first = false;
            await new Promise(resolve=>window.releaseUsage=resolve);
            const {models,cost,coverage,collectingSince}=statisticsFixture;
            receiveStatisticsProgress({requestId,data:{models,cost,coverage,collectingSince}});
            await new Promise(resolve=>window.releaseDetails=resolve);
          }
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
          width: 1400,
          height: 900,
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
            "!!window.releaseUsage && !!document.querySelector('.stats-summary .stats-skeleton')",
          );
          const sizes = () =>
            browser.evaluate<number[][]>(
              `[...document.querySelectorAll('.statistics-page > [data-ui-surface]')].map(e=>{const r=e.getBoundingClientRect();return [r.x,r.y,r.width,r.height]})`,
            );
          const pendingSizes = await sizes();
          await browser.evaluate("window.releaseUsage()");
          await waitFor(
            "!!document.querySelector('.stats-models table') && !!document.querySelector('.stats-daily .stats-skeleton')",
          );
          await browser.evaluate("window.releaseDetails()");
          await waitFor("!document.querySelector('.stats-skeleton')");
          expect(await sizes()).toEqual(pendingSizes);
          const switchDetail = async (index: number, selector: string) => {
            await browser.evaluate(
              `document.querySelectorAll('.stats-tabs button')[${index}].click()`,
            );
            await waitFor(`!!document.querySelector('${selector}')`);
          };
          await waitFor(
            "document.querySelector('.stats-models')?.textContent.includes('Claude Opus')",
          );
          await switchDetail(1, ".stats-commands table");
          const layout = await browser.evaluate<{
            scroll: boolean;
            cards: boolean;
            tokenColumns: number;
            colors: number;
            commands: string[];
            commandsFit: boolean;
            coverage: string;
          }>(`(() => {
            const page=document.querySelector('.statistics-overview');
            const cards=[...page.querySelectorAll('[data-ui-surface="card"]')];
            const visible=cards.every(el=>{const r=el.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight});
            const glass=cards.every(el=>{const c=getComputedStyle(el);return c.opacity==='1'&&c.backgroundColor.startsWith('rgba(')});
            const model=document.querySelector('.stats-commands .stats-scroll');
            const colors=new Set([...page.querySelectorAll('.stats-stack span')].map(el=>getComputedStyle(el).backgroundColor));
            const commands=page.querySelector('.stats-commands .stats-scroll');
            const daily=page.querySelector('.stats-daily').getBoundingClientRect(), panel=page.querySelector('.stats-commands').getBoundingClientRect();
            return {scroll:page.scrollHeight>page.clientHeight+1,cards:visible&&glass&&model.scrollWidth<=model.clientWidth+1,tokenColumns:page.querySelectorAll('.stats-summary > div').length,colors:colors.size,
              commands:[...page.querySelectorAll('.stats-commands tbody th')].map(el=>el.textContent),
              commandsFit:commands.scrollWidth<=commands.clientWidth+1&&Math.abs(daily.left-panel.left)<1&&panel.width>daily.width&&panel.top>daily.bottom,
              coverage:page.querySelector('.stats-commands h2 span').textContent};
          })()`);
          expect(layout).toMatchObject({
            scroll: false,
            cards: true,
            tokenColumns: 5,
            colors: 3,
            commands: [
              "pnpm testbash",
              "git diffbash",
              "Get-ChildItempowershell",
              "rgbash",
              "rgpowershell",
              "git statusbash",
            ],
            commandsFit: true,
            coverage: "未分類 418・未計測 96",
          });
          await Bun.write(
            join(dir, "statistics.png"),
            await browser.screenshot(),
          );
          // The tools card switches to the initial context breakdown in place.
          await switchDetail(2, ".stats-tools table");
          const panel = await browser.evaluate<{ height: number }>(
            "({height:document.querySelector('.stats-tools').getBoundingClientRect().height})",
          );
          await browser.evaluate(
            "document.querySelectorAll('.stats-tabs button')[3].click()",
          );
          await waitFor("!!document.querySelector('.stats-context')");
          await browser.evaluate(
            "document.querySelector('.stats-context .stats-expand').click()",
          );
          await waitFor(
            "!!document.querySelector('.stats-context .stats-nested')",
          );
          const breakdown = await browser.evaluate<{
            groups: string[];
            nested: number;
            overflowX: boolean;
            scroll: boolean;
          }>(`(() => {
            const scroll=document.querySelector('.stats-tools .stats-scroll');
            const page=document.querySelector('.statistics-overview');
            return {
              groups:[...document.querySelectorAll('.stats-context .stats-group th')].map(el=>el.textContent),
              nested:document.querySelectorAll('.stats-context .stats-nested').length,
              overflowX:scroll.scrollWidth>scroll.clientWidth+1,
              scroll:page.scrollHeight>page.clientHeight+1,
            };
          })()`);
          expect(breakdown).toEqual({
            groups: ["システムプロンプト", "ツール定義"],
            nested: 2,
            overflowX: false,
            scroll: false,
          });
          await Bun.write(
            join(dir, "statistics-context.png"),
            await browser.screenshot(),
          );
          expect(
            await browser.evaluate<number>(
              "document.querySelector('.stats-tools').getBoundingClientRect().height",
            ),
          ).toBeLessThanOrEqual(panel.height + 1);
          await browser.evaluate(
            "document.querySelectorAll('.stats-tabs button')[0].click()",
          );
          for (const [width, height] of [
            [1600, 1000],
            [1400, 720],
            [720, 850],
          ]) {
            await browser.command("Emulation.setDeviceMetricsOverride", {
              width,
              height,
              deviceScaleFactor: 1,
              mobile: false,
            });
            await Bun.sleep(100);
            const geometry = await browser.evaluate<{
              aligned: boolean;
              equalDonuts: boolean;
              fullWidth: boolean;
              fullHeight: boolean;
              overflowX: boolean;
              scroll: boolean;
              dates: boolean;
              summaryHeight: number;
              modelHeight: number;
              headings: number;
            }>(`(() => {
              const page=document.querySelector('.statistics-overview');
              const rect=selector=>page.querySelector(selector).getBoundingClientRect();
              const title=rect('.content-page-header h1'), periods=rect('.stats-periods');
              const shell=rect('.content-page-shell'), summary=rect('.stats-summary');
              const style=getComputedStyle(page.querySelector('.content-page-shell'));
              const rings=[...page.querySelectorAll('.stats-donut-ring svg')].map(el=>el.getBoundingClientRect());
              const bottom=Math.max(...[...page.querySelectorAll('[data-ui-surface="card"]')].map(el=>el.getBoundingClientRect().bottom));
              return {
                aligned:Math.abs(title.top+title.height/2-periods.top-periods.height/2)<1,
                equalDonuts:rings.length===2&&Math.abs(rings[0].top-rings[1].top)<1&&Math.abs(rings[0].width-rings[1].width)<1&&Math.abs(rings[0].height-rings[1].height)<1,
                fullWidth:Math.abs(rect('.stats-models').width-shell.width+parseFloat(style.paddingLeft)+parseFloat(style.paddingRight))<1 && shell.width<=1040 && Math.abs(summary.width-rect('.stats-daily').width)<1,
                fullHeight:Math.abs(bottom-shell.bottom+parseFloat(style.paddingBottom))<1,
                overflowX:page.scrollWidth>page.clientWidth+1,
                scroll:page.scrollHeight>page.clientHeight+1,
                dates:page.querySelector('.stats-header').textContent.includes('から記録'),
                summaryHeight:summary.height,
                modelHeight:rect('.stats-models').height,
                headings:page.querySelectorAll('h1').length
              };
            })()`);
            await Bun.write(
              join(dir, `statistics-${width}x${height}.png`),
              await browser.screenshot(),
            );
            expect(geometry).toMatchObject({
              aligned: true,
              equalDonuts: true,
              fullWidth: true,
              overflowX: false,
              dates: false,
              headings: 1,
            });
            expect(geometry.modelHeight).toBeGreaterThan(90);
            if (width >= 1000) {
              expect(geometry.fullHeight).toBe(true);
              expect(geometry.scroll).toBe(false);
            } else {
              expect(
                await browser.evaluate<boolean>(`(() => {
                  const page=document.querySelector('.statistics-overview');
                  page.scrollTop=page.scrollHeight;
                  return page.querySelector('.stats-composition').getBoundingClientRect().bottom<=page.getBoundingClientRect().bottom+1;
                })()`),
              ).toBe(true);
              await browser.evaluate(
                "document.querySelector('.statistics-overview').scrollTop=0",
              );
            }
            const readHeader = () =>
              browser.evaluate<Record<string, number>>(`(() => {
                const title=document.querySelector('.content-page-header h1').getBoundingClientRect();
                const back=document.querySelector('.content-page-header .back-button').getBoundingClientRect();
                return {titleLeft:title.left,titleTop:title.top,backLeft:back.left,backTop:back.top};
              })()`);
            const statisticsHeader = await readHeader();
            for (const page of ["extensions", "settings", "providers"]) {
              await browser.evaluate(`window.fixture.navigate('${page}')`);
              await waitFor(
                `!!document.querySelector('.${page}-page .content-page-header h1')`,
              );
              const referenceHeader = await readHeader();
              await Bun.write(
                join(dir, `${page}-${width}x${height}.png`),
                await browser.screenshot(),
              );
              for (const key of Object.keys(statisticsHeader)) {
                expect(
                  Math.abs(statisticsHeader[key] - referenceHeader[key]),
                ).toBeLessThan(1);
              }
            }
            await browser.evaluate("window.fixture.navigate('statistics')");
            await waitFor(
              "document.querySelector('.stats-models')?.textContent.includes('Claude Opus')",
            );
          }
          await browser.command("Emulation.setDeviceMetricsOverride", {
            width: 1400,
            height: 900,
            deviceScaleFactor: 1,
            mobile: false,
          });
          await Bun.sleep(100);
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
          const motion = (selector: string) =>
            browser.evaluate<string[]>(
              `[...document.querySelector(${JSON.stringify(selector)}).getAnimations({subtree:true})].map(a=>a.animationName??a.transitionProperty)`,
            );
          expect(await motion(".stats-tip")).toContain("tooltip-in");
          await Bun.sleep(200);
          // The next column keeps the same tip: it glides and cross-fades.
          const next = await browser.evaluate<{ x: number; y: number }>(
            `(() => {const r=document.querySelectorAll('.stats-bar-area')[1].getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+20}})()`,
          );
          await browser.command("Input.dispatchMouseEvent", {
            type: "mouseMoved",
            ...next,
          });
          await waitFor(
            "document.querySelector('.stats-bar-area[aria-describedby]')===document.querySelectorAll('.stats-bar-area')[1]",
          );
          const switching = await motion(".stats-tip");
          expect(switching).toContain("left");
          expect(switching).toContain("tooltip-swap");
          expect(switching).not.toContain("tooltip-in");
          expect(
            await browser.evaluate<number>(
              "document.querySelectorAll('.stats-tip').length",
            ),
          ).toBe(1);
          // Donut slices are hoverable: the slice and its legend row light up.
          const slicePoint = (index: number) =>
            browser.evaluate<{ x: number; y: number }>(`(() => {
              const svg=document.querySelector('.stats-donut-ring svg'),c=svg.querySelectorAll('circle[data-slice]')[${index}];
              const length=parseFloat(c.getAttribute('stroke-dasharray')),start=25-parseFloat(c.getAttribute('stroke-dashoffset'));
              const a=(start+length/2)/100*2*Math.PI,b=svg.getBoundingClientRect(),s=Math.min(b.width,b.height)/42;
              return {x:b.left+b.width/2+Math.sin(a)*15.9155*s,y:b.top+b.height/2-Math.cos(a)*15.9155*s};
            })()`);
          await browser.command("Input.dispatchMouseEvent", {
            type: "mouseMoved",
            ...(await slicePoint(0)),
          });
          await waitFor(
            "document.querySelector('.stats-donut .stats-tip:popover-open')&&document.querySelector('.stats-donut circle[data-active]')===document.querySelector('.stats-donut circle[data-slice]')",
          );
          // The fade-back is a transition: let it settle before reading opacity.
          await Bun.sleep(250);
          const highlighted = await browser.evaluate<{
            tip: string;
            label: string;
            faded: number;
          }>(`(() => {
            const donut=document.querySelector('.stats-donut'),tip=donut.querySelector('.stats-tip');
            const label=donut.querySelector('.stats-donut-legend li[data-active] span').textContent;
            const faded=Number(getComputedStyle(donut.querySelectorAll('circle[data-slice]')[1]).opacity);
            return {tip:tip.textContent,label,faded};
          })()`);
          expect(highlighted.tip.startsWith(highlighted.label)).toBe(true);
          expect(highlighted.faded).toBeLessThan(1);
          await Bun.sleep(200);
          await browser.command("Input.dispatchMouseEvent", {
            type: "mouseMoved",
            ...(await slicePoint(1)),
          });
          await waitFor(
            "document.querySelector('.stats-donut circle[data-active]')===document.querySelectorAll('.stats-donut circle[data-slice]')[1]",
          );
          const sliceSwitch = await motion(".stats-donut .stats-tip");
          expect(sliceSwitch).toContain("tooltip-swap");
          expect(sliceSwitch).not.toContain("tooltip-in");
          await Bun.write(
            join(dir, "statistics-donut-tip.png"),
            await browser.screenshot(),
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
            "document.querySelector('.statistics-overview .content-page-header h1')?.textContent==='Statistics'",
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
          await browser.evaluate(
            `document.querySelector('.sidebar-footer button[aria-label="Statistics"]').click()`,
          );
          await waitFor("!!document.querySelector('.statistics-overview')");
          await browser.evaluate(
            "document.querySelector('.statistics-overview .back-button').click()",
          );
          expect(
            await browser.evaluate<string>(
              "window.fixture.useStore.getState().page",
            ),
          ).toBe("chat");
          expect(
            await browser.evaluate<boolean>(
              "!!document.querySelector('.statistics-overview')",
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
