import { test } from "bun:test";
import { existsSync } from "node:fs";
import {
  fixtureEdge,
  fixtureHelpers,
  fixtureImport,
  runUiFixture,
} from "../../scripts/ui-fixture";

const local = (path: string) => fixtureImport(new URL(path, import.meta.url));

test.skipIf(!existsSync(fixtureEdge) && !process.env.PIG_REQUIRE_UI_TESTS)(
  "the composer of an inactive pane recedes as one unit, keeps its size and stays typeable",
  () =>
    runUiFixture(
      "inactive-pane-composer",
      `
      const {createRoot}=await import(${fixtureImport(import.meta.resolve("react-dom/client"))});
      const {flushSync}=await import(${fixtureImport(import.meta.resolve("react-dom"))});
      const {ChatLayout}=await import(${local("./ChatLayout.tsx")});
      const {ComposerFrame}=await import(${local("./ComposerFrame.tsx")});
      const {ModelPicker}=await import(${local("./ModelPicker.tsx")});
      const {useStore}=await import(${local("./store.ts")});
      await import(${local("./styles.css")});
      await import(${local("./session-panel.css")});
      await import(${local("./composer.css")});
      await import(${local("./panes.css")});
      ${fixtureHelpers}
      const root=createFixtureRoot(createRoot);
      const provider={id:'openai-codex',name:'OpenAI Codex',configured:true};
      const models=[{provider:provider.id,id:'model-0',name:'Model 0',effortLevels:['low','high'],effectiveDefaultEffort:'high'}];
      useStore.setState(s=>({bootstrap:{...s.bootstrap,providers:[provider],models,disabledModels:[],accountCatalogs:undefined},settings:{...s.settings,language:'en'}}));
      const pane=(active)=>(
        <section className="pane-view" data-active={active} style={{position:'absolute',top:0,bottom:0,left:active?0:'50%',width:'50%'}}>
          <ChatLayout composer={<ComposerFrame><div className="composer"><textarea defaultValue="draft"/><div className="composer-toolbar"><ModelPicker selection={{model:models[0],effort:'high',effortLevels:['low','high']}}/><button type="button" className="send-button">send</button></div></div></ComposerFrame>}>
            <div>chat</div>
          </ChatLayout>
        </section>);
      flushSync(()=>root.render(<div style={{position:'fixed',inset:0}}>{pane(true)}{pane(false)}</div>));
      await wait();
      const [on,off]=[...document.querySelectorAll('.pane-view')].map(p=>p.querySelector('.composer'));
      const alpha=(color)=>{const m=color.match(/[\\d.]+/g).map(Number);return color.startsWith('rgba')||color.includes('/')?m[3]:1;};
      const ink=(el,sel)=>getComputedStyle(el.querySelector(sel)).color;
      for(const sel of ['textarea','.model-picker > summary','.send-button'])
        check(alpha(ink(off,sel))<0.7&&alpha(ink(on,sel))>0.9,sel+' ink must fade only in the inactive pane: '+ink(on,sel)+' / '+ink(off,sel));
      const glass=(el)=>getComputedStyle(el,'::before').backgroundColor;
      check(glass(off)!==glass(on)&&alpha(glass(off))>0,'the inactive composer keeps a visible, quieter surface: '+glass(off));
      check(getComputedStyle(off).boxShadow==='none'&&getComputedStyle(on).boxShadow!=='none','only the active composer floats');
      check(getComputedStyle(off).opacity==='1','no whole-surface opacity');
      check(off.getBoundingClientRect().height===on.getBoundingClientRect().height,'receding must not change the composer size');
      check(!off.querySelector('textarea').disabled,'the inactive composer stays typeable');
      `,
    ),
  60_000,
);
