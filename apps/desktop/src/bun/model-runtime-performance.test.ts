import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("new model runtimes do not launch one full refresh for every builtin provider", async () => {
  const home = await mkdtemp(join(tmpdir(), "pig-model-startup-"));
  try {
    const script = `
      import {expect} from "bun:test";
      import {ModelRuntime} from "@earendil-works/pi-coding-agent";
      const native=ModelRuntime.prototype.refresh;
      let refreshes=0;
      ModelRuntime.prototype.refresh=function(options){refreshes++;return native.call(this,options);};
      const {createModelRuntime,releaseModelRuntime}=await import(${JSON.stringify(new URL("./model-runtime.ts", import.meta.url).href)});
      const started=performance.now();
      const runtime=await createModelRuntime();
      const ms=performance.now()-started;
      await Bun.sleep(100);
      console.log(JSON.stringify({providers:runtime.getRegisteredProviderIds().length,nativeRefreshes:refreshes,createMs:ms}));
      expect(runtime.getProvider("openai-api")).toBeDefined();
      expect(refreshes).toBeLessThanOrEqual(2);
      releaseModelRuntime(runtime);
    `;
    const child = Bun.spawn([process.execPath, "--eval", script], {
      cwd: join(import.meta.dir, "../.."),
      env: {
        ...process.env,
        HOME: home,
        USERPROFILE: home,
        PI_CODING_AGENT_DIR: "",
        PI_CODING_AGENT_SESSION_DIR: "",
        PI_OFFLINE: "1",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    console.info("Model runtime startup", stdout.trim());
    expect(code, stderr).toBe(0);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}, 20_000);
