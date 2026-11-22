// Offline SessionHost probe. Never opens the real profile or starts WebView.
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const home = await mkdtemp(join(tmpdir(), "pig-history-retention-"));
try {
  const sessions = join(home, "sessions");
  await mkdir(sessions);
  const source = `
    import {strict as assert} from "node:assert";
    import {randomBytes} from "node:crypto";
    import {join} from "node:path";
    import {fauxProvider, fauxAssistantMessage} from "@earendil-works/pi-ai";
    import {SessionHost} from ${JSON.stringify(new URL("../src/bun/session-host.ts", import.meta.url).href)};
    import {modelInfo, disposeSessions} from ${JSON.stringify(new URL("../src/bun/pi-service.ts", import.meta.url).href)};
    import {readSessionFile,sessionHistoryDigest} from ${JSON.stringify(new URL("../src/bun/session-files.ts", import.meta.url).href)};
    import {RUNTIME_IDLE_MS} from ${JSON.stringify(new URL("../src/shared/runtime-contract.ts", import.meta.url).href)};
    const cwd=process.env.HOME, directory=process.env.PI_CODING_AGENT_SESSION_DIR;
    const faux=fauxProvider({tokensPerSecond:Infinity,models:[{id:"fixture",input:["text"]}]});
    let now=0, sequence=0, starts=0;
    const host=new SessionHost({
      modelInfo, idleNow:()=>now, historyModel:()=>modelInfo(faux.getModel()),
      configureModels:async models=>{starts++;models.registerNativeProvider(faux.provider);},
      emit(){}, emitTerminal(){},
      emitUI(event){
        if(event.type==="request"&&event.request.kind==="project-trust")
          queueMicrotask(()=>host.resolveExtensionUI({...event.request,kind:"project-trust",value:"once"}));
      },
    });
    const usage=()=>({sequence:++sequence,protected:[]});
    host.connectUI({clientId:"measure",usage:usage()});
    const heartbeat=()=>host.heartbeatUI({clientId:"measure",usage:usage()});
    const mib=bytes=>+(bytes/1048576).toFixed(2), ms=value=>+value.toFixed(1);
    const timestamp=new Date().toISOString();
    async function fixture(id,turns) {
      let parentId=null;
      const lines=[JSON.stringify({type:"session",version:3,id,cwd,timestamp})];
      for(let i=0;i<turns;i++) {
        const answer=fauxAssistantMessage("Fixture "+i+"\\n"+randomBytes(24576).toString("base64"));
        for(const message of [{role:"user",content:"Question "+i,timestamp:i},answer]) {
          const entry={type:"message",id:crypto.randomUUID(),parentId,timestamp,message};
          parentId=entry.id;lines.push(JSON.stringify(entry));
        }
      }
      return mib(await Bun.write(join(directory,id+".jsonl"),lines.join("\\n")+"\\n"));
    }
    async function checkpoint(label) {
      await Bun.sleep(0); Bun.gc(true); await Bun.sleep(5); Bun.gc(true);
      const {heapUsed,rss,external}=process.memoryUsage();
      const entries=host.runtimeState().sessions;
      console.log(JSON.stringify({label,heapMiB:mib(heapUsed),rssMiB:mib(rss),externalMiB:mib(external),
        live:entries.filter(s=>!s.suspended).length,cold:entries.filter(s=>s.suspended).length,starts}));
    }
    const open=id=>host.openSession({cwd,id,historyOnly:true,openId:"cold-"+id});
    async function measure(id,turns) {
      const fileMiB=await fixture(id,turns);
      await checkpoint(id+"-before");
      const start=performance.now();
      let snap=await open(id);
      const openMs=ms(performance.now()-start);
      const {revision,before}=snap.transcript.history;
      assert(before);
      const cursor={...snap.address,revision,before};
      snap=undefined;
      async function pages(address) {
        const times=[];
        let rows, chars;
        for(let i=0;i<7;i++){
          const start=performance.now();
          const page=await host.getSessionHistory({...address,revision,before});
          times.push(ms(performance.now()-start));
          rows=page.records.length;
          chars=page.records.reduce((n,record)=>n+(record.kind==="message"&&record.message.role==="assistant"
            ? record.message.content.reduce((sum,part)=>sum+(part.text?.length??0),0):0),0);
        }
        assert(rows>0&&chars>0);
        return {ms:times,rows,chars};
      }
      const cold=await pages(cursor);
      await checkpoint(id+"-after-cold-pages");
      const parts=[];
      for(let i=0;i<3;i++){
        const start=performance.now();
        const manager=await readSessionFile(cwd,id);
        const readMs=ms(performance.now()-start), hashStart=performance.now();
        assert.equal(sessionHistoryDigest(manager).length,64);
        parts.push({discoveryReadParseMs:readMs,digestMs:ms(performance.now()-hashStart)});
      }
      const wake=(await host.wakeSession(cursor)).address;
      const live=await pages(wake);
      assert.deepEqual([cold.rows,cold.chars],[live.rows,live.chars]);
      console.log(JSON.stringify({id,fileMiB,openMs,cold,live,parts}));
      await host.closeSession(wake);
    }
    try {
      await measure("fixture-small",64);
      await measure("fixture-large",512);
      const ids=[];
      for(let i=0;i<8;i++){const id="fixture-multi-"+i;await fixture(id,64);ids.push(id);}
      await checkpoint("multi-baseline");
      const addresses=[];
      for(const id of ids) addresses.push((await open(id)).address);
      await checkpoint("8-history-only");
      for(const address of addresses) await host.wakeSession(address);
      await checkpoint("8-live-idle");
      heartbeat(); await host.suspendIdle(); now+=RUNTIME_IDLE_MS; heartbeat();
      assert.equal(await host.suspendIdle(),8);
      await checkpoint("8-suspended");
    } finally {
      await host.dispose(); await disposeSessions();
    }
  `;
  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    APPDATA: home,
    LOCALAPPDATA: home,
    PI_CODING_AGENT_DIR: join(home, "agent"),
    PI_CODING_AGENT_SESSION_DIR: sessions,
    PI_OFFLINE: "1",
  };
  for (const key of Object.keys(env))
    if (/API_KEY|TOKEN|SECRET|PASSWORD/i.test(key))
      delete (env as NodeJS.ProcessEnv)[key];
  const child = Bun.spawn([process.execPath, "--eval", source], {
    cwd: join(import.meta.dir, ".."),
    env,
    stdout: "inherit",
    stderr: "inherit",
  });
  process.exitCode = await child.exited;
} finally {
  await rm(home, { recursive: true, force: true });
}
