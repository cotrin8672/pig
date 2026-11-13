// Starts a separate offline process with an empty temporary profile. Never loads
// the user's credentials, model config, extensions, or session files.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const home = await mkdtemp(join(tmpdir(), "pig-model-retention-"));
try {
  const source = `
    const {createModelRuntime,releaseModelRuntime}=await import(${JSON.stringify(new URL("../src/bun/model-runtime.ts", import.meta.url).href)});
    const retained=[];
    const sample=label=>{Bun.gc(true);const m=process.memoryUsage();return {label,retainedRuntimes:retained.length,heapUsedMiB:m.heapUsed/1024/1024,rssMiB:m.rss/1024/1024};};
    const samples=[sample("before")];
    for(let i=1;i<=20;i++){
      retained.push(await createModelRuntime());
      if([1,5,10,20].includes(i))samples.push(sample("created-"+i));
    }
    while(retained.length)releaseModelRuntime(retained.pop());
    await Bun.sleep(20);samples.push(sample("released"));
    console.log(JSON.stringify({samples,note:"empty offline ModelRuntimes only; no AgentSessions, extensions, transcript, WebView, or leak claim"}));
  `;
  const child = Bun.spawn([process.execPath, "--eval", source], {
    cwd: join(import.meta.dir, ".."),
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      PI_CODING_AGENT_DIR: join(home, "agent"),
      PI_CODING_AGENT_SESSION_DIR: join(home, "sessions"),
      PI_OFFLINE: "1",
    },
    stdout: "inherit",
    stderr: "inherit",
  });
  process.exitCode = await child.exited;
} finally {
  await rm(home, { recursive: true, force: true });
}
