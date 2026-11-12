import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("add-account OAuth publishes only on success; cancel/failure do not create rows or overwrite standard pi auth", async () => {
  const home = await mkdtemp(join(tmpdir(), "pig-account-login-"));
  try {
    const script = `
      import {expect} from "bun:test";
      import {mkdir,writeFile,readFile} from "node:fs/promises";
      import {join} from "node:path";
      import {fauxProvider} from "@earendil-works/pi-ai";
      const home=${JSON.stringify(home)}, provider="openai-codex";
      const token=access=>({type:"oauth",access,refresh:"r-"+access,expires:Date.now()+3600000});
      const file=join(home,".pi/agent/auth.json");
      await mkdir(join(home,".pi/agent"),{recursive:true});
      await mkdir(join(home,".config/pig"),{recursive:true});
      await writeFile(file,JSON.stringify({[provider]:token("standard")}));
      const app=await import(${JSON.stringify(new URL("./pi-service.ts", import.meta.url).href)});
      const login=await import(${JSON.stringify(new URL("./login.ts", import.meta.url).href)});
      const {providerAccounts}=await import(${JSON.stringify(new URL("./provider-accounts.ts", import.meta.url).href)});
      let mode="success";
      let started=Promise.withResolvers();
      const faux=fauxProvider({provider});
      app.runtime.registerNativeProvider({...faux.provider,auth:{oauth:{name:"Subscription",isSubscription:true,
        login:async interaction=>{
          started.resolve();
          if(mode==="fail") throw new Error("fixture failure");
          if(mode==="cancel") await new Promise((resolve,reject)=>interaction.signal.addEventListener("abort",()=>reject(new Error("cancelled")),{once:true}));
          return token("new");
        }, refresh:async value=>value, toAuth:async value=>({apiKey:value.access}),
      }}});
      const frames=[];
      mode="cancel";
      const cancelled=login.startLogin(provider,"oauth","cancel",frame=>frames.push(frame),()=>true,undefined,true);
      await started.promise;
      expect(await providerAccounts.list()).toEqual([]);
      login.cancelLogin("cancel"); await cancelled;
      expect(frames.at(-1).kind).toBe("cancelled");
      expect(await providerAccounts.list()).toEqual([]);
      mode="fail";
      await login.startLogin(provider,"oauth","fail",frame=>frames.push(frame),()=>true,undefined,true);
      expect(frames.at(-1).kind).toBe("error");
      expect(await providerAccounts.list()).toEqual([]);
      mode="success";
      await login.startLogin(provider,"oauth","success",frame=>frames.push(frame),()=>true,undefined,true);
      expect(frames.at(-1).kind).toBe("success");
      const account=(await providerAccounts.list())[0];
      expect(account).toMatchObject({label:"OpenAI Codex 2",configured:true});
      expect(frames.at(-1).accountId).toBe(account.id);
      await login.startLogin(provider,"oauth","another",frame=>frames.push(frame),()=>true,undefined,true);
      expect((await providerAccounts.list()).map(a=>a.label)).toEqual(["OpenAI Codex 2","OpenAI Codex 3"]);
      await providerAccounts.renameDefault(provider,"Codex Private");
      expect((await app.listProviders()).find(p=>p.id===provider).accountLabel).toBe("Codex Private");
      expect(JSON.parse(await readFile(file,"utf8"))[provider].access).toBe("standard");
      await app.disposeSessions();
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
    expect(code, stdout + stderr).toBe(0);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}, 60_000);
