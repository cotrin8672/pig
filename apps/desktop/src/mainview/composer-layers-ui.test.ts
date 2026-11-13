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
  "composer popovers in Edge: model picker blurs the chat and covers the jump button",
  () =>
    runUiFixture(
      "composer-layers",
      `
      const {createRoot}=await import(${fixtureImport(import.meta.resolve("react-dom/client"))});
      const {flushSync}=await import(${fixtureImport(import.meta.resolve("react-dom"))});
      const {ChatLayout}=await import(${local("./ChatLayout.tsx")});
      const {ComposerFrame}=await import(${local("./ComposerFrame.tsx")});
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
      const stripes={height:3000,background:'repeating-linear-gradient(90deg,#000 0 2px,#fff 2px 4px)'};
      flushSync(()=>root.render(
        <div style={{position:'fixed',inset:0,display:'flex'}}>
          <ChatLayout composer={<ComposerFrame><div className="composer"><ModelPicker selection={{model:models[0],effort:'off',effortLevels:[]}}/></div></ComposerFrame>}>
            <div style={stripes}/>
          </ChatLayout>
        </div>));
      await wait();
      const thread=document.querySelector('.thread-scroll');
      thread.scrollTop=thread.scrollHeight;await wait();
      thread.scrollTop=thread.scrollHeight-900;
      await until(()=>document.querySelector('.thread-scroll-to-bottom'),'jump-to-bottom button appears away from the end');
      document.querySelector('.model-picker > summary').click();
      await until(()=>document.querySelector('.model-panel')?.getBoundingClientRect().height>0,'model picker opens');
      const panel=document.querySelector('.model-panel').getBoundingClientRect();
      const jump=document.querySelector('.thread-scroll-to-bottom').getBoundingClientRect();
      const x=jump.left+jump.width/2,y=jump.top+jump.height/2;
      check(x>panel.left&&x<panel.right&&y>panel.top&&y<panel.bottom,'fixture must place the picker over the jump button');
      check(document.elementFromPoint(x,y)?.closest('.model-panel'),'the open model picker must be above the jump-to-bottom button');

      const pixel=await capturePixels();
      const composer=document.querySelector('.composer').getBoundingClientRect();
      const width=48;
      // Background visible through each glass layer, sampled in text-free padding.
      const raw=lineDeviation(pixel,8,composer.top-60,width);
      const picker=lineDeviation(pixel,panel.left+(panel.width-width)/2,panel.top+2,width);
      const composerGlass=lineDeviation(pixel,composer.right-width-14,composer.top+3,width);
      check(raw>60,'stripes must be sharp outside the glass: '+raw);
      check(picker<8,'model picker must blur the chat behind it (nested backdrop root): '+picker);
      check(composerGlass<8,'composer must still blur the chat behind it: '+composerGlass);
      `,
    ),
  60_000,
);
