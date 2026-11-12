import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("account login, session selection, sends, persistence and forks retain canonical providers and never use another account", async () => {
  const home = await mkdtemp(join(tmpdir(), "pig-session-accounts-"));
  try {
    const script = `
      import { expect } from "bun:test";
      import { mkdir, writeFile, readFile } from "node:fs/promises";
      import { join } from "node:path";
      import { fauxProvider, fauxAssistantMessage } from "@earendil-works/pi-ai";
      const home = ${JSON.stringify(home)};
      const provider = "openai-codex";
      const token = access => ({type:"oauth",access,refresh:"refresh-"+access,expires:Date.now()+3_600_000});
      const authFile = join(home,".pi/agent/auth.json");
      await mkdir(join(home,".pi/agent"),{recursive:true});
      await writeFile(authFile,JSON.stringify({[provider]:token("default")}));
      const app = await import(${JSON.stringify(new URL("./pi-service.ts", import.meta.url).href)});
      const login = await import(${JSON.stringify(new URL("./login.ts", import.meta.url).href)});
      const { providerAccounts } = await import(${JSON.stringify(new URL("./provider-accounts.ts", import.meta.url).href)});
      const { SessionHost } = await import(${JSON.stringify(new URL("./session-host.ts", import.meta.url).href)});
      const { DesktopStateStore } = await import(${JSON.stringify(new URL("./desktop-state.ts", import.meta.url).href)});
      const faux = fauxProvider({provider,tokensPerSecond:Infinity,models:[{id:"one"},{id:"two"}]});
      let nextLogin = "";
      const subscription = {...faux.provider,auth:{oauth:{name:"Subscription",isSubscription:true,
        login: async () => token(nextLogin), refresh:async current => current, toAuth:async current => ({apiKey:current.access}),
      }},filterModels:(models,credential) => credential?.access === "private" ? models.filter(m => m.id === "one") : models};
      app.runtime.registerNativeProvider(subscription);
      const work = await login.createProviderAccount(provider,"Codex Work");
      const personal = await login.createProviderAccount(provider,"Codex Private");
      const frames = [];
      for(const [account,access] of [[work,"work"],[personal,"private"]]) {
        nextLogin = access;
        await login.startLogin(provider,"oauth",account.id,frame => frames.push(frame),() => true,account.id);
        expect(frames.at(-1)).toMatchObject({kind:"success",accountId:account.id});
      }
      expect(JSON.stringify(await app.listProviders())).not.toContain("refresh-work");
      expect((await app.listProviders()).find(p => p.id === provider).accounts).toHaveLength(2);
      expect((await app.accountModels(provider,work.id)).map(m => [m.provider,m.id])).toEqual([[provider,"one"],[provider,"two"]]);
      expect((await app.accountModels(provider,personal.id)).map(m => m.id)).toEqual(["one"]);
      expect(() => login.createProviderAccount("openai-api","Not a subscription")).toThrow();
      await login.renameProviderAccount(provider,work.id,"Renamed Work");
      expect((await providerAccounts.list()).find(a => a.id === work.id).label).toBe("Renamed Work");
      const disk = new DesktopStateStore(join(home,"desktop.json")); await disk.load();
      let failSave = false;
      const options = {modelInfo:app.modelInfo,emit(){},emitUI(){},emitTerminal(){},
        configureModels:runtime => runtime.registerNativeProvider(subscription),
        sessionAccounts:{read:id => disk.value.sessions[id]?.accounts ?? {},write:async (id,accounts) => {
          if(failSave) throw new Error("fixture save failed");
          await disk.setSessionAccounts(id,accounts);
        }},
      };
      const host = new SessionHost(options);
      let a = await host.openSession({cwd:home,openId:"work"});
      let b = await host.openSession({cwd:home,openId:"private"});
      const select = (chat,accountId,id="one") => host.setModel({...chat.address,provider,id,accountId});
      expect((await select(a,work.id)).accountId).toBe(work.id);
      expect((await select(b,personal.id)).accountId).toBe(personal.id);
      const currentAuth = chat => host.session(chat.info.id).modelRuntime.getAuth(provider);
      expect((await currentAuth(a)).auth.apiKey).toBe("work");
      expect((await currentAuth(b)).auth.apiKey).toBe("private");
      // Unavailable models must not fall back to the default account or another model.
      await expect(select(a,personal.id,"two")).rejects.toThrow("unavailable");
      expect((await currentAuth(a)).auth.apiKey).toBe("work");
      expect(disk.value.sessions[a.info.id].accounts[provider]).toBe(work.id);
      failSave = true;
      await expect(select(a,personal.id)).rejects.toThrow("fixture save failed");
      failSave = false;
      expect((await currentAuth(a)).auth.apiKey).toBe("work");
      expect(host.getSessionSnapshot(a.address).accountId).toBe(work.id);
      // Legacy model-only requests keep the chat's chosen account; null explicitly chooses pi's default.
      expect((await host.setModel({...a.address,provider,id:"two"})).accountId).toBe(work.id);
      expect((await select(a,null)).accountId).toBeUndefined();
      expect((await currentAuth(a)).auth.apiKey).toBe("default");
      await select(a,work.id);
      const seen = [];
      faux.setResponses([(_context,opts) => {seen.push(opts.apiKey); return fauxAssistantMessage("work reply");},
        (_context,opts) => {seen.push(opts.apiKey); return fauxAssistantMessage("private reply");}]);
      await host.prompt({...a.address,requestId:"a",text:"work",draftRevision:0});
      await host.receipts.settled();
      await host.prompt({...b.address,requestId:"b",text:"private",draftRevision:0});
      await host.receipts.settled();
      expect(seen).toEqual(["work","private"]);
      await expect(select(a,personal.id)).rejects.toThrow("new chat");
      expect((await host.setModel({...a.address,provider,id:"two"})).accountId).toBe(work.id);
      a = host.getSessionSnapshot(a.address);
      const assistant = a.transcript.records.find(r => r.kind === "message" && r.message.role === "assistant");
      expect(assistant.message.provider).toBe(provider);
      const fork = await host.forkSession({...a.address,entryId:assistant.entryId});
      expect(fork.accountId).toBe(work.id);
      expect(disk.value.sessions[fork.info.id].accounts[provider]).toBe(work.id);
      await host.dispose();
      const reloaded = new DesktopStateStore(join(home,"desktop.json")); await reloaded.load();
      expect(reloaded.value.sessions[a.info.id].accounts[provider]).toBe(work.id);
      const second = new SessionHost(options);
      const reopened = await second.openSession({cwd:home,id:a.info.id,openId:"reopen"});
      expect(reopened.accountId).toBe(work.id);
      expect((await second.session(a.info.id).modelRuntime.getAuth(provider)).auth.apiKey).toBe("work");
      await login.logoutProvider(provider,work.id);
      await expect(second.session(a.info.id).modelRuntime.getAuth(provider)).rejects.toThrow();
      expect((await app.runtime.getAuth(provider)).auth.apiKey).toBe("default");
      await second.closeSession(reopened.address);
      await expect(second.openSession({cwd:home,id:a.info.id,openId:"signed-out"})).rejects.toThrow("signed out");
      await login.removeProviderAccount(provider,work.id);
      expect((await providerAccounts.list()).map(a => a.id)).toEqual([personal.id]);
      expect(JSON.parse(await readFile(authFile,"utf8"))[provider].access).toBe("default");
      await second.dispose(); await app.disposeSessions();
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
