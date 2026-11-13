import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import {
  fixtureBrowser,
  removeFixtureDirectory,
} from "../../scripts/ui-browser";

const browser =
  process.env.PIG_UI_BROWSER ??
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
test.skipIf(!existsSync(browser) && !process.env.PIG_REQUIRE_UI_TESTS)(
  "production inline render workers in Edge: exact text, math and a live UI heartbeat",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "pig-production-workers-"));
    let server: ReturnType<typeof Bun.serve> | undefined;
    let page: Awaited<ReturnType<typeof fixtureBrowser>> | undefined;
    try {
      const source = (name: string) =>
        JSON.stringify(
          fileURLToPath(new URL(name, import.meta.url)).replaceAll("\\", "/"),
        );
      await Bun.write(
        join(directory, "fixture.ts"),
        `
      import {syntaxWorker} from ${source("./syntax-worker-client.ts")};
      import {markdownWorker} from ${source("./markdown-worker-client.ts")};
      let ticks=0,last=performance.now(),maxGap=0;
      const timer=setInterval(()=>{const now=performance.now();maxGap=Math.max(maxGap,now-last);last=now;ticks++;},5);
      const check=(condition,message)=>{if(!condition)throw new Error(message);};
      window.__productionWorkers=(async()=>{
        const text="export const value = <span data-test='fixture'>content</span>;\\n".repeat(1000);
        const before=ticks,start=performance.now();
        const syntax=await syntaxWorker.run({text,language:"tsx"});
        check(syntax.map(line=>line.map(token=>token.content).join("")).join("\\n")===text,"every highlighted source byte must survive production worker packaging");
        check(ticks>before,"syntax compilation must not monopolize the UI thread");
        const syntaxMs=performance.now()-start,mathBefore=ticks,mathStart=performance.now();
        const math=await markdownWorker.run({text:"$$ x^2 + y^2 = z^2 $$\\n\\n".repeat(100)});
        check(math.tree.type==="root" && JSON.stringify(math.tree).includes("katex"),"production worker must complete real KaTeX without DOM APIs or a UI fallback");
        check(ticks>mathBefore,"math parsing must not monopolize the UI thread");
        maxGap=Math.max(maxGap,performance.now()-last);
        return {ok:true,syntaxMs,mathMs:performance.now()-mathStart,maxGapMs:maxGap,ticks,syntax:syntaxWorker.stats(),markdown:markdownWorker.stats()};
      })().catch(error=>({ok:false,error:String(error),syntax:syntaxWorker.stats(),markdown:markdownWorker.stats()})).finally(()=>clearInterval(timer));
    `,
      );
      const dist = join(directory, "dist");
      await build({
        configFile: fileURLToPath(
          new URL("../../vite.config.ts", import.meta.url),
        ),
        root: fileURLToPath(new URL("./", import.meta.url)),
        logLevel: "error",
        build: {
          outDir: dist,
          emptyOutDir: true,
          rollupOptions: {
            input: join(directory, "fixture.ts"),
            output: { entryFileNames: "assets/fixture.js" },
          },
        },
      });
      await Bun.write(
        join(dist, "index.html"),
        '<!doctype html><meta charset="utf-8"><script type="module" src="/assets/fixture.js"></script>',
      );
      const files = new Map<string, string>();
      for await (const file of new Bun.Glob("**/*").scan({
        cwd: dist,
        onlyFiles: true,
      }))
        files.set(`/${file.replaceAll("\\", "/")}`, join(dist, file));
      server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        fetch(request) {
          const path = new URL(request.url).pathname;
          const file = files.get(path === "/" ? "/index.html" : path);
          return file
            ? new Response(Bun.file(file))
            : new Response(null, { status: 404 });
        },
      });
      page = await fixtureBrowser(browser, directory, server.url.href);
      let ready = false;
      const deadline = Date.now() + 15_000;
      while (!ready && Date.now() < deadline) {
        ready = await page.evaluate<boolean>("!!window.__productionWorkers");
        if (!ready) await Bun.sleep(25);
      }
      expect(ready).toBe(true);
      const report = await page.evaluate<{
        ok: boolean;
        syntax: { failed: boolean; completed: number };
        markdown: { failed: boolean; completed: number };
      }>("window.__productionWorkers");
      expect(report.ok, JSON.stringify(report)).toBe(true);
      expect(report.syntax).toMatchObject({ failed: false, completed: 1 });
      expect(report.markdown).toMatchObject({ failed: false, completed: 1 });
      console.log("Production render workers Edge", JSON.stringify(report));
    } finally {
      await page?.close();
      await server?.stop(true);
      await removeFixtureDirectory(directory);
    }
  },
  60_000,
);
