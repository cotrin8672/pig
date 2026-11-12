import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const edge = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
test.skipIf(!existsSync(edge))(
  "provider/account UI in Edge: nested rows, immediate sign-in, inline rename and account-aware picker",
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "pig-provider-ui-"));
    try {
      const source = (name: string) =>
        JSON.stringify(fileURLToPath(new URL(name, import.meta.url)));
      const entry = join(dir, "entry.tsx");
      await Bun.write(
        entry,
        `
      import {createRoot} from ${JSON.stringify(fileURLToPath(import.meta.resolve("react-dom/client")))};
      import {flushSync} from ${JSON.stringify(fileURLToPath(import.meta.resolve("react-dom")))};
      import {Providers} from ${source("./Providers.tsx")};
      import {ModelPicker} from ${source("./ModelPicker.tsx")};
      import {useStore} from ${source("./store.ts")};
      import {accountSourceKey,accountModelKey} from ${source("../shared/account-models.ts")};
      const root=createRoot(document.getElementById("root"));
      const wait=()=>new Promise(r=>setTimeout(r,40));
      const check=(value,message)=>{if(!value) throw new Error(message);};
      const render=async node=>{flushSync(()=>root.render(node));await wait();};
      const click=async node=>{check(node,"missing button");node.click();await wait();};
      const byLabel=label=>document.querySelector('[aria-label="'+label+'"]');
      const calls=window.calls=[];
      const provider={id:"openai-codex",name:"OpenAI Codex",oauth:{subscription:true},configured:true,stored:true,source:"OAuth",apiKey:false,extension:false,
        accounts:[{id:"work",provider:"openai-codex",label:"Codex Work",configured:true},{id:"old",provider:"openai-codex",label:"Old account",configured:false}]};
      const model={provider:provider.id,id:"sol",name:"Sol",contextWindow:500000,reasoning:true,effortLevels:["low","high"],effectiveDefaultEffort:"low"};
      const base=useStore.getState().bootstrap;
      const bootstrap={...base,providers:[provider],models:[model],accountCatalogs:{[accountSourceKey(provider.id)]:[model],[accountSourceKey(provider.id,"work")]:[model],[accountSourceKey(provider.id,"old")]:[]},disabledModels:[],desktop:{sessions:{},recentModels:[accountModelKey(model),accountModelKey(model,"work")]}};
      window.bootstrap=bootstrap;
      window.refresh=()=>useStore.setState({bootstrap:window.bootstrap});
      useStore.setState({bootstrap,settings:{...useStore.getState().settings,language:"en"}});
      const address={hostId:"ui",sessionId:"chat",epoch:1};
      const snapshot={address,snapshotSeq:1,info:{id:"chat",cwd:"fixture",title:"Chat",modified:1},model,effort:"low",effortLevels:["low","high"],transcript:{records:[],tools:{},history:{revision:"a"},current:null,running:false,liveToEntry:{}},modelCatalog:[model],sessionAccounts:{},accountSwitchAllowed:true};
      window.selected=async params=>{calls.push(["setModel",params]);return {model,accountId:params.accountId??undefined,effort:"low",effortLevels:["low","high"]};};
      window.rename=async params=>{calls.push(["rename",params]);window.bootstrap={...window.bootstrap,providers:[{...provider,accounts:provider.accounts.map(a=>a.id===params.accountId?{...a,label:params.label}:a)}]};return {...provider.accounts[0],label:params.label};};
      window.main=async()=>{
        await render(<Providers/>);
        check(document.querySelectorAll('.provider-account-row[data-nested]').length===3,"accounts must nest below canonical provider");
        check(!document.querySelector('.provider-account-group .acp-count'),"no count next to +");
        await click(byLabel("Add account to OpenAI Codex"));
        check(useStore.getState().login?.addAccount===true,"+ must immediately request existing login popup");
        check(!document.querySelector('input.inline-rename'),"adding must not ask for a name");
        check(document.querySelectorAll('.provider-account-row[data-nested]').length===3,"no placeholder account before successful auth");
        useStore.setState({login:undefined});
        const workRow=[...document.querySelectorAll('.provider-account-row[data-nested]')].find(r=>r.textContent.includes("Codex Work"));
        await click(workRow.querySelector('.provider-row'));
        check(document.querySelector('.provider-detail h2').textContent==="Codex Work","detail title identifies selected account");
        check(document.querySelector('.provider-model-panel input[type=checkbox]'),"detail must retain real model switches");
        await click(workRow.querySelector('.thread-more'));
        await click([...document.querySelectorAll(':popover-open [role=menuitem]')].find(b=>b.textContent.includes("Edit name")));
        const input=document.querySelector('input.inline-rename');
        check(input===document.activeElement,"rename must focus inline input like projects");
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(input,"Client Work");
        input.dispatchEvent(new Event("input",{bubbles:true}));await wait();
        input.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true}));await wait();
        check(calls.some(([kind,p])=>kind==="rename"&&p.accountId==="work"&&p.label==="Client Work"),"rename must use stable account id");
        check(document.querySelector('.provider-detail h2').textContent==="Client Work","rename must update detail without changing selection");
        const first=document.querySelector('.provider-account-row[data-nested]');
        check(first.querySelector('.provider-account-dot').compareDocumentPosition(first.querySelector('.provider-row-name'))&Node.DOCUMENT_POSITION_FOLLOWING,"status dot must lead account label");
        useStore.setState({snapshots:{chat:snapshot}});
        await render(<ModelPicker snapshot={snapshot}/>);
        await click(document.querySelector('summary'));
        let options=[...document.querySelectorAll('.model-option')];
        check(options.length===2,"recent same model must appear separately for default and work");
        await click(options[1]);
        check(calls.some(([kind,p])=>kind==="setModel"&&p.accountId==="work"),"account id must travel with the selected model");
        await click(document.querySelector('summary'));
        await click([...document.querySelectorAll('.model-source-rail button')].find(b=>b.textContent.includes("OpenAI Codex 1")));
        await click(document.querySelector('.model-option'));
        check(calls.some(([kind,p])=>kind==="setModel"&&p.accountId===null),"default account must be explicit, not omitted");
        const locked={...snapshot,accountId:"work",sessionAccounts:{[provider.id]:"work"},accountSwitchAllowed:false};
        useStore.setState({snapshots:{chat:locked}});
        await render(<ModelPicker key="locked" snapshot={locked}/>);
        await click(document.querySelector('summary'));
        await click([...document.querySelectorAll('.model-source-rail button')].find(b=>b.textContent.includes("OpenAI Codex 1")));
        const before=calls.filter(c=>c[0]==="setModel").length;
        await click(document.querySelector('.model-option'));
        check(calls.filter(c=>c[0]==="setModel").length===before,"locked model choice must not issue a request");
        await click([...document.querySelectorAll('.model-account-action button')][0]);
        check(calls.some(([kind,args])=>kind==="openChat"&&args[0]==="fixture"&&args[3]?.model.id==="sol"&&!args[3]?.accountId),"new chat must carry the requested account/model before sends");
        await render(<ModelPicker key="signed-out" snapshot={snapshot}/>);
        await click(document.querySelector('summary'));
        await click([...document.querySelectorAll('.model-source-rail button')].find(b=>b.textContent.includes("Old account")));
        await click(document.querySelector('.model-account-action button'));
        check(useStore.getState().login?.accountId==="old"&&!useStore.getState().login?.addAccount,"reauth must target the signed-out account, not add or replace the standard account");
      };
      main().then(()=>document.getElementById("report").textContent=JSON.stringify({ok:true,calls})).catch(error=>document.getElementById("report").textContent=JSON.stringify({ok:false,error:String(error),stack:error.stack,calls}));
    `,
      );
      const built = await Bun.build({
        entrypoints: [entry],
        target: "browser",
        define: { "process.env.NODE_ENV": '"production"' },
        plugins: [
          {
            name: "provider-fixture",
            setup(build) {
              build.onResolve({ filter: /^react\/jsx-runtime$/ }, () => ({
                path: fileURLToPath(import.meta.resolve("react/jsx-runtime")),
              }));
              build.onResolve({ filter: /\.css$/ }, (args) => ({
                path: args.path,
                namespace: "fixture-css",
              }));
              build.onLoad({ filter: /.*/, namespace: "fixture-css" }, () => ({
                contents: "",
                loader: "css",
              }));
              build.onResolve({ filter: /^\.\/rpc$/ }, () => ({
                path: "rpc",
                namespace: "fixture-rpc",
              }));
              build.onLoad({ filter: /.*/, namespace: "fixture-rpc" }, () => ({
                contents: `
        export const refresh=async()=>window.refresh?.(), updateSettings=()=>{}, updateUiPreferences=()=>{};
        export const requestSelection=(_a,fn)=>fn();
        export const openChat=(...args)=>{window.calls.push(["openChat",args]);};
        export const rpc={send:{startLogin:params=>window.calls.push(["login",params]),cancelLogin:()=>{}},request:{
          renameProviderAccount:params=>window.rename(params),renameDefaultProviderAccount:async params=>window.calls.push(["renameDefault",params]),
          setModelsEnabled:async()=>[],setModelEnabled:async()=>[],setDefaultEffort:async()=>{},setModelOverride:async()=>{},refreshProviderModels:async()=>{},
          logout:async()=>{},removeProviderAccount:async()=>{},setModel:params=>window.selected(params),
        }};
      `,
                loader: "js",
              }));
            },
          },
        ],
      });
      expect(built.success, built.logs.map(String).join("\n")).toBe(true);
      const js = built.outputs.find((output) => output.path.endsWith(".js"));
      if (!js) throw new Error("Missing fixture JavaScript");
      await Bun.write(join(dir, "fixture.js"), js);
      await Bun.write(
        join(dir, "index.html"),
        '<div id="root"></div><pre id="report"></pre><script type="module" src="./fixture.js"></script>',
      );
      const child = Bun.spawn(
        [
          edge,
          "--headless=new",
          "--disable-gpu",
          "--no-first-run",
          "--allow-file-access-from-files",
          `--user-data-dir=${join(dir, "profile")}`,
          "--virtual-time-budget=15000",
          "--dump-dom",
          pathToFileURL(join(dir, "index.html")).href,
        ],
        { stdout: "pipe", stderr: "pipe" },
      );
      const [code, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      const content = stdout
        .match(/<pre id="report">(.*?)<\/pre>/s)?.[1]
        ?.replaceAll("&quot;", '"')
        .replaceAll("&amp;", "&")
        .replaceAll("&lt;", "<")
        .replaceAll("&gt;", ">");
      expect(code, stderr).toBe(0);
      expect(content, stdout.slice(-3000) + stderr.slice(-500)).toBeTruthy();
      expect(JSON.parse(content ?? "{}")).toMatchObject({ ok: true });
    } finally {
      await rm(dir, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 200,
      });
    }
  },
  60_000,
);
