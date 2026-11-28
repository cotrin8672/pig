import { test } from "bun:test";
import {
  fixtureHelpers,
  fixtureImport,
  runUiFixture,
} from "../scripts/ui-fixture";

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
        const {Overview:motion}=await import(${source("../src/stories/design-system/Motion.stories.tsx")});
        const button=await import(${source("../src/stories/design-system/Button.stories.tsx")});
        const {States:buttonStory}=button;
        const buttonPage={render:()=> <buttonStory.render/>};
        const iconButton=await import(${source("../src/stories/design-system/IconButton.stories.tsx")});
        const spinner=await import(${source("../src/stories/design-system/Spinner.stories.tsx")});
        const {States:select}=await import(${source("../src/stories/design-system/Select.stories.tsx")});
        const controls=[
          (await import(${source("../src/stories/design-system/Switch.stories.tsx")})).States,
          (await import(${source("../src/stories/design-system/Checkbox.stories.tsx")})).States,
          select,
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
        const {ComposerActions}=await import(${source("../src/stories/composer/ComposerSubmit.stories.tsx")});
        const {States:usageMeter}=await import(${source("../src/stories/design-system/UsageMeter.stories.tsx")});
        const {States:copyButton}=await import(${source("../src/stories/design-system/CopyButton.stories.tsx")});
        const {InviteBody}=await import(${source("../src/mainview/PairingDialogs.tsx")});
        const {States:archiveToggle}=await import(${source("../src/stories/design-system/ArchiveToggle.stories.tsx")});
        const {States:countButton}=await import(${source("../src/stories/design-system/ComposerCountButton.stories.tsx")});
        const {States:pickerOption}=await import(${source("../src/stories/design-system/PickerOption.stories.tsx")});
        const {States:dialogFrame}=await import(${source("../src/stories/design-system/DialogFrame.stories.tsx")});
        const {States:errorAlert}=await import(${source("../src/stories/design-system/ErrorAlert.stories.tsx")});
        const {States:sheet}=await import(${source("../src/stories/design-system/Sheet.stories.tsx")});
        const catalog=[
          usageMeter,copyButton,archiveToggle,countButton,pickerOption,dialogFrame,errorAlert,sheet,
          (await import(${source("../src/stories/design-system/ContentPage.stories.tsx")})).States,
          (await import(${source("../src/stories/design-system/ColorPicker.stories.tsx")})).States,
          (await import(${source("../src/stories/design-system/LazyDetails.stories.tsx")})).States,
          (await import(${source("../src/stories/design-system/Tooltip.stories.tsx")})).States,
          (await import(${source("../src/stories/design-system/ImagePreview.stories.tsx")})).States,
          (await import(${source("../src/stories/design-system/EffortSlider.stories.tsx")})).States,
          (await import(${source("../src/stories/design-system/ModelSelect.stories.tsx")})).States,
          (await import(${source("../src/stories/design-system/ProviderUsageView.stories.tsx")})).States,
          (await import(${source("../src/stories/design-system/ChatListRow.stories.tsx")})).States,
          (await import(${source("../src/stories/design-system/MessageBubble.stories.tsx")})).States,
          (await import(${source("../src/stories/design-system/ChatTextArea.stories.tsx")})).States,
          (await import(${source("../src/stories/design-system/ComposerForm.stories.tsx")})).States,
          (await import(${source("../src/stories/design-system/ComposerEditor.stories.tsx")})).States,
        ];
        await import(${source("../src/mainview/styles.css")});
        await import(${source("../src/stories/glass-stage.css")});
        ${fixtureHelpers}
        const root=createFixtureRoot(createRoot);
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
          foundations.ColorAndTypography,foundations.SurfacesAndOutput,motion,
          buttonPage,iconButton.States,spinner.States,patterns.Settings,patterns.Interactions,
          providers.Providers,files.FileTypes,...controls,
          chip.States,dot.States,count.States,keycap.States,...newStories,
          ComposerActions,...catalog,
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
            if(story===dot.States){
              const dots=[...variants.querySelectorAll('figure')];
              check(dots.length>=5&&dots.every(cell=>cell.querySelector('span[aria-hidden="true"]')),'labelled rows have decorative dots');
            }
            if(story===keycap.States){
              check([...variants.querySelectorAll('kbd')].map(el=>el.textContent).join(',')==='K,Enter,Esc,←,↓','key names and arrows');
              for(const key of page.querySelectorAll('kbd')){
                const style=getComputedStyle(key),rect=key.getBoundingClientRect();
                check(parseFloat(style.borderTopWidth)>=1 && style.backgroundColor!=='rgba(0, 0, 0, 0)','key face and outline visible without search palette CSS');
                check(rect.width>=rect.height-1 && rect.height>=1.75*parseFloat(style.fontSize),'key face fits a single glyph at current text scale');
              }
            }
            if([...controls,...newStories,...catalog,providers.Providers,files.FileTypes,buttonPage,iconButton.States,spinner.States,chip.States,dot.States,count.States,keycap.States].includes(story)){
              const stage=page.querySelector('.ds-specimen-stage').getBoundingClientRect();
              check(stage.height>=180 && stage.bottom<=variants.getBoundingClientRect().top,'usage example precedes states');
              check(!page.querySelector('.ds-review-boundary'),'no proposal notice on shipped components');
              for(const cell of variants.querySelectorAll('figure'))check(cell.querySelector('figcaption')?.textContent&&cell.getBoundingClientRect().height>=80,'each variant has space and a caption');
            }else if(story===motion){
              check(page.querySelectorAll('.ds-review-table a').length===6&&!page.querySelector('button,select'),'motion links to live components without duplicating them');
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
        const dispatch=async(method,params)=>{
          window.__fixtureInput={method,params};
          await until(()=>!window.__fixtureInput,'native input was dispatched');
        };
        const durations=(element,pseudo)=>getComputedStyle(element,pseudo).transitionDuration.split(', ').slice(0,2).join(' ');
        await render(select);
        const selectField=document.querySelector('.ds-specimen-example select');
        const selectRect=selectField.getBoundingClientRect();
        const center={x:selectRect.x+selectRect.width/2,y:selectRect.y+selectRect.height/2,button:'left',clickCount:1};
        await dispatch('Input.dispatchMouseEvent',{...center,type:'mousePressed'});
        await dispatch('Input.dispatchMouseEvent',{...center,type:'mouseReleased'});
        await until(()=>selectField.matches(':open'),'native select opens');
        check(durations(selectField,'::picker(select)')==='0.14s 0.14s','select opens with opacity and scale');
        const escapeKey={key:'Escape',code:'Escape',windowsVirtualKeyCode:27};
        await dispatch('Input.dispatchKeyEvent',{...escapeKey,type:'keyDown'});
        await dispatch('Input.dispatchKeyEvent',{...escapeKey,type:'keyUp'});
        await until(()=>!selectField.matches(':open'),'Escape closes the native select');
        check(durations(selectField,'::picker(select)')==='0.08s 0s','select closes with the shorter fade only');
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
        check(durations(menu)==='0.14s 0.14s','actions menu opens with the same opacity and scale timings');
        menu.querySelector('button').click();await wait();
        check(!menu.matches(':popover-open'),'menu selection closes popover');
        check(durations(menu)==='0.08s 0s'&&getComputedStyle(menu).pointerEvents==='none','actions menu fades out without taking input');
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
        await render(copyButton);
        const copy=document.querySelector('.ds-specimen-example .copy-button');
        const beforeCopy=copy.getBoundingClientRect();
        check(copy.querySelector('.lucide-copy'),'copy starts idle');
        copy.focus();
        copy.click();await wait();
        const tick=copy.querySelector('.lucide-check');
        check(copy.getAttribute('aria-label')==='コピー済み'&&tick,'success announces copied');
        check(getComputedStyle(tick).animationName==='completion-pop'&&getComputedStyle(tick).animationDuration==='0.12s','the success check plays the 120ms completion motion');
        copy.click();await wait();
        check(!tick.isConnected&&copy.querySelector('.completion-pop')&&document.activeElement===copy,'another success replays only the icon, retaining button focus');
        const afterCopy=copy.getBoundingClientRect();
        check(['x','y','width','height'].every(key=>beforeCopy[key]===afterCopy[key]),'copy feedback does not shift layout');
        const [persistent,disabled,failing]=document.querySelectorAll('.ds-specimen-variants button');
        check(persistent.matches('.settings-icon-button')&&persistent.offsetWidth===32,'standalone copy keeps the shared icon-button face');
        check(disabled.disabled,'copy is disabled without content');
        persistent.click();failing.click();await wait();
        check(failing.querySelector('.lucide-copy')&&document.querySelector('[role="alert"]'),'failure reports error without showing success');
        await new Promise(resolve=>setTimeout(resolve,1600));await wait();
        check(copy.getAttribute('aria-label')==='コマンドをコピー'&&copy.querySelector('.lucide-copy'),'transient feedback resets');
        check(getComputedStyle(copy.querySelector('.lucide-copy')).animationName==='none','the idle icon returns without motion');
        check(persistent.querySelector('.lucide-check'),'persistent feedback stays visible');
        let rejectCopy=true,written,inviteCopies=0;
        Object.defineProperty(navigator,'clipboard',{configurable:true,value:{
          writeText:async text=>{if(rejectCopy)throw Error('Clipboard denied');written=text},
        }});
        await render({render:()=> <InviteBody code="example-invite" left={60} stage="idle" onCopy={()=>inviteCopies++}/>});
        const invite=document.querySelector('.mac-copy button');
        invite.click();
        await until(()=>document.querySelector('.mac-copy .mac-row-detail'),'invite shows the clipboard error');
        check(inviteCopies===0&&invite.querySelector('.lucide-copy'),'failed copy does not advance pairing or show success');
        rejectCopy=false;
        invite.click();
        await until(()=>!!invite.querySelector('.completion-pop'),'invite plays the shared completion motion');
        check(inviteCopies===1&&written==='example-invite'&&!document.querySelector('.mac-copy .mac-row-detail'),'only successful copy advances pairing and clears its error');
        await render(archiveToggle);
        const archive=document.querySelector('.ds-specimen-example button');
        check(archive.getAttribute('aria-pressed')==='false'&&archive.textContent.endsWith('(3)'),'archive button shows count');
        archive.click();await wait();
        check(archive.getAttribute('aria-pressed')==='true'&&archive.textContent==='チャット一覧に戻る','archive shows return action');
        check(!document.querySelector('.ds-specimen-variants figure:last-child button'),'empty archive is hidden');
        await render(countButton);
        const counter=document.querySelector('.ds-specimen-example .session-indicator');
        const counterPanel=document.getElementById(counter.getAttribute('aria-controls'));
        counter.click();await wait();
        check(counter.type==='button'&&counter.getAttribute('aria-expanded')==='true'&&counterPanel.matches(':popover-open'),'count button opens the associated popover without submitting a form');
        counter.click();await wait();
        check(counter.getAttribute('aria-expanded')==='false'&&!counterPanel.matches(':popover-open'),'count button closes the same popover');
        await render(pickerOption);
        const [local,remote]=document.querySelectorAll('.ds-specimen-example [role="option"]');
        const marker=remote.querySelector('.model-selected-mark');
        const markerWidth=marker.getBoundingClientRect().width;
        remote.click();await wait();
        check(local.getAttribute('aria-selected')==='false'&&remote.getAttribute('aria-selected')==='true','one picker option is selected');
        check(marker.querySelector('.lucide-check')&&marker.getAttribute('aria-hidden')==='true'&&marker.getBoundingClientRect().width===markerWidth,'picker check is decorative and does not resize the marker slot');
        check(document.querySelector('.ds-specimen-variants button:disabled'),'unavailable picker option stays disabled');
        await render(dialogFrame);
        document.querySelector('.ds-specimen-example > button').click();await wait();
        const frame=document.querySelector('.dialog-frame[open]');
        check(frame&&frame.getAttribute('aria-modal')==='false'&&!frame.matches(':modal'),'shared frame is non-modal');
        check(document.getElementById(frame.getAttribute('aria-labelledby'))?.textContent==='設定内容の確認','frame is labelled by its title');
        check(frame.getBoundingClientRect().width===Math.min(520,innerWidth-32),'frame retains the default size');
        const escape=(el,isComposing=false)=>el.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true,isComposing}));
        escape(frame,true);await wait();
        check(frame.open,'IME Escape does not dismiss the frame');
        escape(frame);await wait();
        check(!frame.open,'Escape dismisses the frame');
        await render(sheet);
        const opener=document.querySelector('.ds-specimen-variants figure:last-child button');
        opener.focus();opener.click();await wait();
        const openedSheet=document.querySelector('dialog.mac-sheet');
        openedSheet.getAnimations().forEach(animation=>animation.finish());
        const codeInput=openedSheet.querySelector('input');
        check(openedSheet.open&&document.activeElement===codeInput,'sheet focuses its own input on open');
        check(openedSheet.getBoundingClientRect().width===Math.min(560,innerWidth-32),'wide sheet keeps its own width over frame defaults');
        check(getComputedStyle(openedSheet).transitionDuration.split(',')[0]==='0.16s','sheet retains its opening motion without pairing-page CSS');
        escape(codeInput);await wait();
        check(!openedSheet.open&&openedSheet.isConnected&&document.activeElement===opener,'sheet stays mounted and restores opener focus on close');
        check(getComputedStyle(openedSheet).transitionDuration.split(',')[0]==='0.09s','sheet retains its closing motion');
        await render(ComposerActions);
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
