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
  "the composer stays above the chat whether Send is enabled or disabled, and the model picker covers the jump button",
  () =>
    runUiFixture(
      "composer-layers",
      `
      const {createRoot}=await import(${fixtureImport(import.meta.resolve("react-dom/client"))});
      const {flushSync}=await import(${fixtureImport(import.meta.resolve("react-dom"))});
      const {ChatLayout}=await import(${local("./ChatLayout.tsx")});
      const {ComposerFrame}=await import(${local("./ComposerFrame.tsx")});
      const {ComposerSubmit}=await import(${local("./ComposerSubmit.tsx")});
      const {ModelPicker}=await import(${local("./ModelPicker.tsx")});
      const {useStore}=await import(${local("./store.ts")});
      await import(${local("./styles.css")});
      await import(${local("./session-panel.css")});
      ${fixtureHelpers}
      const root=createFixtureRoot(createRoot);
      const provider={id:'openai-codex',name:'OpenAI Codex',configured:true};
      const models=Array.from({length:12},(_,i)=>({provider:provider.id,id:'model-'+i,name:'Model '+i,effortLevels:[],effectiveDefaultEffort:'off'}));
      useStore.setState(s=>({bootstrap:{...s.bootstrap,providers:[provider],models,disabledModels:[],accountCatalogs:undefined},settings:{...s.settings,language:'en'}}));
      // 1px vertical stripes: unblurred they keep high contrast along a horizontal line.
      const stripes={height:3000,position:'relative',zIndex:99,background:'repeating-linear-gradient(90deg,#000 0 2px,#fff 2px 4px)'};
      const render=(disabled)=>flushSync(()=>root.render(
        <div style={{position:'fixed',inset:0,display:'flex'}}>
          <ChatLayout composer={<ComposerFrame><div className="composer">
            <textarea aria-label="Message"/>
            <div className="composer-toolbar">
              <ModelPicker selection={{model:models[0],effort:'off',effortLevels:[]}}/>
              <ComposerSubmit busy={false} hasContent={!disabled} disabled={disabled} onStop={()=>{}}/>
            </div>
          </div></ComposerFrame>}>
            <div style={stripes}/>
          </ChatLayout>
        </div>));
      render(false);
      await wait();
      const thread=document.querySelector('.thread-scroll');
      thread.scrollTop=thread.scrollHeight;await wait();
      thread.scrollTop=thread.scrollHeight-900;
      await until(()=>document.querySelector('.thread-scroll-to-bottom'),'jump-to-bottom button appears away from the end');
      const width=48;
      for(const disabled of [false,true]){
        render(disabled);
        await wait();
        const surface=document.querySelector('.composer').getBoundingClientRect();
        check(document.querySelector('.send-button').disabled===disabled,'fixture must toggle Send');
        check(document.elementFromPoint(surface.left+20,surface.top+15)?.closest('.composer'),'the composer must cover the transcript (Send disabled: '+disabled+')');
        const glass=lineDeviation(await capturePixels(),surface.right-width-14,surface.top+3,width);
        check(glass<8,'sharp transcript content must not interfere with the composer (Send disabled: '+disabled+'): '+glass);
      }
      document.querySelector('.model-picker > summary').click();
      await until(()=>document.querySelector('.model-panel')?.getBoundingClientRect().height>0,'model picker opens');
      const panel=document.querySelector('.model-panel').getBoundingClientRect();
      const jump=document.querySelector('.thread-scroll-to-bottom').getBoundingClientRect();
      const x=jump.left+jump.width/2,y=jump.top+jump.height/2;
      check(x>panel.left&&x<panel.right&&y>panel.top&&y<panel.bottom,'fixture must place the picker over the jump button');
      check(document.elementFromPoint(x,y)?.closest('.model-panel'),'the open model picker must be above the jump-to-bottom button');

      const pixel=await capturePixels();
      const composer=document.querySelector('.composer').getBoundingClientRect();
      // Background visible through each glass layer, sampled in text-free padding.
      const raw=lineDeviation(pixel,8,composer.top-60,width);
      const picker=lineDeviation(pixel,panel.left+(panel.width-width)/2,panel.top+2,width);
      check(raw>60,'stripes must be sharp outside the glass: '+raw);
      check(picker<8,'model picker must blur the chat behind it (nested backdrop root): '+picker);
      `,
    ),
  60_000,
);
