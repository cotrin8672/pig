import { test } from "bun:test";
import { fixtureImport, runUiFixture } from "../scripts/ui-fixture";

const source = (path: string) => fixtureImport(new URL(path, import.meta.url));

for (const viewport of [
  { width: 1100, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`design system review: layout, translucent cards and local interactions at ${viewport.width}px`, async () => {
    await runUiFixture(
      `design-system-${viewport.width}`,
      `
        const {createRoot}=await import(${fixtureImport(import.meta.resolve("react-dom/client"))});
        const {flushSync}=await import(${fixtureImport(import.meta.resolve("react-dom"))});
        const foundations=await import(${source("../src/stories/design-system/Foundations.stories.tsx")});
        const button=await import(${source("../src/stories/design-system/Button.stories.tsx")});
        const {States:buttonStory}=button;
        const buttonPage={render:()=> <buttonStory.render/>};
        const iconButton=await import(${source("../src/stories/design-system/IconButton.stories.tsx")});
        const spinner=await import(${source("../src/stories/design-system/Spinner.stories.tsx")});
        const controls=[
          (await import(${source("../src/stories/design-system/Switch.stories.tsx")})).States,
          (await import(${source("../src/stories/design-system/Checkbox.stories.tsx")})).States,
          (await import(${source("../src/stories/design-system/Select.stories.tsx")})).States,
          (await import(${source("../src/stories/design-system/TextField.stories.tsx")})).States,
        ];
        const newStories=[
          (await import(${source("../src/stories/design-system/SegmentedControl.stories.tsx")})).States,
          (await import(${source("../src/stories/design-system/SearchField.stories.tsx")})).States,
          (await import(${source("../src/stories/design-system/SettingsCard.stories.tsx")})).States,
          (await import(${source("../src/stories/design-system/SettingsRow.stories.tsx")})).States,
          (await import(${source("../src/stories/design-system/ActionsMenu.stories.tsx")})).States,
          (await import(${source("../src/stories/design-system/InlineRename.stories.tsx")})).States,
          (await import(${source("../src/stories/design-system/ConfirmButton.stories.tsx")})).Default,
        ].map(story=>({...story,render:()=> <story.render/>}));
        const providers=await import(${source("../src/stories/design-system/ProviderIcon.stories.tsx")});
        const files=await import(${source("../src/stories/design-system/FileIcon.stories.tsx")});
        const chip=await import(${source("../src/stories/design-system/Chip.stories.tsx")});
        const dot=await import(${source("../src/stories/design-system/IndicatorDot.stories.tsx")});
        const count=await import(${source("../src/stories/design-system/CountBadge.stories.tsx")});
        const keycap=await import(${source("../src/stories/design-system/Keycap.stories.tsx")});
        const patterns=await import(${source("../src/stories/design-system/patterns-ui-fixture.tsx")});
        const domain=await import(${source("../src/stories/design-system/Domain.stories.tsx")});
        await import(${source("../src/mainview/styles.css")});
        await import(${source("../src/stories/glass-stage.css")});
        const check=(condition,message)=>{if(!condition)throw Error(message)};
        const wait=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        const root=createRoot(document.getElementById('root'));
        let generation=0;
        const render=async story=>{
          flushSync(()=>root.render(
            <div key={++generation} className="glass-stage">
              <div className="glass-wallpaper" />
              <div className="app-shell glass-shell" style={{'--window-opacity':0.78}}>
                <div className="glass-scroll"><div className="transcript">{story.render()}</div></div>
              </div>
            </div>));
          await wait();
        };
        const pages=[
          foundations.ColorAndTypography,foundations.SurfacesAndOutput,
          buttonPage,iconButton.States,spinner.States,patterns.Settings,patterns.Interactions,
          providers.Providers,files.FileTypes,...controls,
          chip.States,dot.States,count.States,keycap.States,...newStories,
          domain.ComposerActions,domain.DomainBoundary,
        ];
        const canvas=document.createElement('canvas'),context=canvas.getContext('2d');
        for(const scale of [1,1.3]){
          document.documentElement.style.setProperty('--font-scale',scale);
          for(const story of pages){
            await render(story);
            const page=document.querySelector('.ds-review,.ds-specimen'),scroll=document.querySelector('.glass-scroll');
            check(page&&page.querySelector('h1'),'page title');
            const variants=page.querySelector('.ds-specimen-variants');
            if(story===count.States)check([...variants.querySelectorAll('.notification-badge')].map(el=>el.textContent).join(',')==='1,99,99+','zero hidden; counts capped after 99');
            if(story===dot.States)check(variants.querySelectorAll('span[aria-hidden="true"]').length===5,'labelled rows have decorative dots');
            if(story===keycap.States){
              check([...variants.querySelectorAll('kbd')].map(el=>el.textContent).join(',')==='K,Enter,Esc,←,↓','key names and arrows');
              for(const key of page.querySelectorAll('kbd')){
                const style=getComputedStyle(key),rect=key.getBoundingClientRect();
                check(parseFloat(style.borderTopWidth)>=1 && style.backgroundColor!=='rgba(0, 0, 0, 0)','key face and outline visible without search palette CSS');
                check(rect.width>=rect.height-1 && rect.height>=1.75*parseFloat(style.fontSize),'key face fits a single glyph at current text scale');
              }
            }
            if([...controls,...newStories,providers.Providers,files.FileTypes,buttonPage,iconButton.States,spinner.States,chip.States,dot.States,count.States,keycap.States].includes(story)){
              const stage=page.querySelector('.ds-specimen-stage').getBoundingClientRect();
              check(stage.height>=180 && stage.bottom<=variants.getBoundingClientRect().top,'usage example precedes states');
              check(!page.querySelector('.ds-review-boundary'),'no proposal notice on shipped components');
              for(const cell of variants.querySelectorAll('figure'))check(cell.querySelector('figcaption')?.textContent&&cell.getBoundingClientRect().height>=80,'each variant has space and a caption');
            }else check(page.textContent.includes('Storybookで方針を確認する段階'),'review-only notice');
            check(page.scrollWidth<=page.clientWidth+1,story.name+': catalogue horizontal overflow');
            check(scroll.scrollWidth<=scroll.clientWidth+1,story.name+': stage horizontal overflow');
            for(const field of page.querySelectorAll('.ds-review-setting > input:not([type="checkbox"])')){
              const rect=field.getBoundingClientRect(),label=field.previousElementSibling.getBoundingClientRect();
              check(rect.width>=160,'setting text field remains usable');
              if(innerWidth<=390)check(rect.top>=label.bottom,'narrow settings stack rather than squash the field');
            }
            for(const card of page.querySelectorAll('[data-ui-surface="card"]')){
              const style=getComputedStyle(card),rect=card.getBoundingClientRect();
              context.clearRect(0,0,1,1);context.fillStyle=style.backgroundColor;context.fillRect(0,0,1,1);
              const alpha=context.getImageData(0,0,1,1).data[3];
              check(alpha>0&&alpha<255&&style.opacity==='1','card uses a translucent background layer');
              check(rect.right<=page.getBoundingClientRect().right+1,'card stays within page');
            }
            const output=page.querySelector('.ds-review-output');
            if(output){
              const style=getComputedStyle(output);
              const limit=8*parseFloat(style.lineHeight)+parseFloat(style.paddingTop)+parseFloat(style.paddingBottom)+8;
              check(output.getBoundingClientRect().height<=limit+1,'eight-line output frame');
              check(output.scrollHeight>output.clientHeight,'output scrolls internally');
              check(output.textContent.trim().split('\\n').length===20,'all output lines are retained');
              output.scrollTop=output.scrollHeight;
              output.scrollLeft=output.scrollWidth;
              check(output.scrollTop>0,'last output line is reachable');
              check(getComputedStyle(output).getPropertyValue('--scrollbar-inset').trim()!=='4px','rounded output inset');
            }
          }
        }
        await render(buttonPage);
        const primary=document.querySelector('.ds-specimen-example button.primary:not(:disabled)');
        primary.click();await wait();
        check(document.querySelector('output').textContent.includes('1'),'button changes only local counter');
        await render(patterns.Interactions);
        const confirm=document.querySelector('.confirm-button'),width=confirm.getBoundingClientRect().width;
        confirm.click();await wait();
        check(confirm.classList.contains('armed'),'first confirmation press arms');
        check(Math.abs(confirm.getBoundingClientRect().width-width)<1,'confirmation keeps its width');
        confirm.click();await wait();
        check([...document.querySelectorAll('output')].some(node=>node.textContent.includes('確定回数: 1')),'second press confirms locally');
        confirm.click();await wait();
        confirm.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await wait();
        check(!confirm.classList.contains('armed'),'Escape disarms confirmation');
        const trigger=document.querySelector('[aria-label="サンプル項目の操作"]');
        trigger.click();await wait();
        const menu=document.querySelector('[role="menu"]');
        check(menu.matches(':popover-open'),'production actions menu opens');
        menu.querySelector('button').click();await wait();
        check(!menu.matches(':popover-open'),'menu selection closes popover');
        check([...document.querySelectorAll('output')].some(node=>node.textContent==='編集を選択'),'menu selection is local');
        const rename=[...document.querySelectorAll('button')].find(node=>node.textContent==='サンプルの名前を変更');
        rename.click();await wait();
        const input=document.querySelector('.inline-rename');
        check(document.activeElement===input,'rename focuses input');
        input.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await wait();
        check(!document.querySelector('.inline-rename'),'Escape cancels inline rename');
        check(document.activeElement.textContent==='サンプルの名前を変更','rename restores focus');
        const openDialog=[...document.querySelectorAll('button')].find(node=>node.textContent==='確認の見本を開く');
        openDialog.focus();
        openDialog.click();await wait();
        const dialog=document.querySelector('dialog');
        check(dialog.open&&dialog.matches(':modal'),'native confirmation dialog opens');
        dialog.querySelector('button').click();await wait();
        check(!dialog.open&&document.activeElement===openDialog,'dialog closes and restores focus');
        await render(domain.ComposerActions);
        const buttons=[...document.querySelectorAll('.send-button')];
        check(buttons.length===7,'all submit states are represented');
        const bounds=buttons.map(button=>button.getBoundingClientRect());
        check(bounds.every(rect=>Math.abs(rect.width-bounds[0].width)<1&&Math.abs(rect.height-bounds[0].height)<1),'submit states keep dimensions');
        check(buttons[0].type==='submit'&&!buttons[0].disabled,'send action');
        check(buttons[1].disabled,'empty input cannot send');
        check(buttons[2].type==='button'&&buttons[2].querySelector('.lucide-square'),'stop action');
        check(buttons[3].type==='submit','typed next message sends');
        check(buttons[4].disabled&&buttons[4].getAttribute('aria-busy')==='true','waiting action');
        check(buttons[5].disabled&&buttons[5].getAttribute('aria-busy')==='true','stopping action');
        check(buttons[6].querySelector('.lucide-play'),'resume action');
        check(buttons.every(button=>button===button.parentElement.lastElementChild),'no messages below submit examples');
        `,
      { viewport },
    );
  }, 120_000);
}
