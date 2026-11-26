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
  "an extension editor update does not interrupt typing or sending",
  () =>
    runUiFixture(
      "composer-extension-update",
      `
      const {createRoot}=await import(${fixtureImport(import.meta.resolve("react-dom/client"))});
      const {flushSync}=await import(${fixtureImport(import.meta.resolve("react-dom"))});
      const {Composer}=await import(${local("./Composer.tsx")});
      const {drafts,emptyContent}=await import(${local("./draft-store.ts")});
      const {receiveExtension}=await import(${local("./runtime-events.ts")});
      const {sends}=await import(${local("./rpc.ts")});
      const {useStore}=await import(${local("./store.ts")});
      const {hydrate}=await import(${local("../shared/transcript.ts")});
      await import(${local("./styles.css")});
      ${fixtureHelpers}
      const root=createFixtureRoot(createRoot),sent=[];
      const address={hostId:'fixture',sessionId:'extension-update',epoch:1};
      const model={provider:'fixture',id:'model',name:'Fixture'};
      const snapshot={address,snapshotSeq:1,info:{id:address.sessionId,cwd:'fixture',title:'Editor',modified:1},
        model,effort:'off',effortLevels:[],transcript:hydrate([])};
      let remote={...emptyContent(),text:'extension text',revision:1};
      window.__requests={
        listSlashCommands:()=>[],
        syncDraft:params=>{
          if(params.expectedRevision!==remote.revision)return {applied:false,draft:remote};
          remote={...params.content,revision:remote.revision+1};
          return {applied:true,draft:remote};
        },
        prompt:params=>{sent.push(params.text);return {disposition:'started'};},
      };
      flushSync(()=>useStore.setState(s=>({hostId:address.hostId,addresses:{[address.sessionId]:address},
        bootstrap:{...s.bootstrap,models:[model],disabledModels:[]},settings:{...s.settings,language:'en'}})));
      flushSync(()=>root.render(<Composer snapshot={snapshot}/>));await wait();
      const editor=document.querySelector('.composer textarea');
      flushSync(()=>drafts.edit(address,c=>({...c,text:'my draft'})));
      editor.focus();editor.setSelectionRange(1,3);
      flushSync(()=>receiveExtension({type:'draft',address,draft:remote}));
      check(editor===document.activeElement&&editor.value==='my draft'&&editor.selectionStart===1&&editor.selectionEnd===3,
        'extension updates must preserve input, focus and selection');
      check(!document.querySelector('.draft-conflict,dialog[open]'),'no draft choice UI');
      const submit=document.querySelector('.send-button');
      check(!submit.disabled,'send must remain enabled');
      submit.click();
      await until(()=>sends.read(address)?.state==='accepted','send must finish');
      check(sent.length===1&&sent[0]==='my draft','only the submitted text is sent');
      check(!useStore.getState().noticeHistory.length,'no error notification');
      root.unmount();
      `,
      { realRpc: true },
    ),
  60_000,
);

test.skipIf(!existsSync(fixtureEdge) && !process.env.PIG_REQUIRE_UI_TESTS)(
  "composer editing in Edge: undo/redo, recall, draft restoration, IME and pane isolation",
  () =>
    runUiFixture(
      "composer-editor",
      `
      const {createRoot}=await import(${fixtureImport(import.meta.resolve("react-dom/client"))});
      const {flushSync}=await import(${fixtureImport(import.meta.resolve("react-dom"))});
      const {Composer}=await import(${local("./Composer.tsx")});
      const {OpeningComposer}=await import(${local("./ChatOpening.tsx")});
      const {sizeEditor}=await import(${local("./ComposerEditor.tsx")});
      const {drafts,emptyContent}=await import(${local("./draft-store.ts")});
      const {useStore}=await import(${local("./store.ts")});
      const {hydrate}=await import(${local("../shared/transcript.ts")});
      await import(${local("./styles.css")});
      ${fixtureHelpers}
      const root=createFixtureRoot(createRoot);
      const model={provider:'fixture',id:'model',name:'Fixture'};
      const snapshot={address:{hostId:'fixture',sessionId:'editor',epoch:1},snapshotSeq:1,
        info:{id:'editor',cwd:'fixture',title:'Editor',modified:1},model,effort:'off',effortLevels:[],
        transcript:hydrate([{role:'user',content:'first prompt',timestamp:1},{role:'user',content:'second prompt',timestamp:2}])};
      window.__requests={listSlashCommands:()=>[{name:'hello',category:'extension'},{name:'help',category:'extension'}],
        searchProjectPaths:({query})=>query.startsWith('src/')?[{path:'src/app.ts',directory:false}]:[{path:'src',directory:true},{path:'my dir',directory:true}].filter(i=>i.path.includes(query)),
        syncDraft:params=>({status:'accepted',draft:{...params.content,revision:params.expectedRevision+1,owner:{kind:'user'}}})};
      flushSync(()=>useStore.setState(s=>({bootstrap:{...s.bootstrap,models:[model],disabledModels:[]},
        settings:{...s.settings,language:'en',keybindings:{}}})));
      const render=async(element)=>{flushSync(()=>root.render(element));await wait();};
      const field=()=>document.querySelector('textarea');
      const press=async(key,modifiers={})=>{
        const event=new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true,...modifiers});
        field().dispatchEvent(event);await wait();return event;
      };
      const trusted=async(method,params)=>{
        window.__fixtureInput={method,params};
        await until(()=>!window.__fixtureInput,'trusted input processed');await wait();
      };
      const insert=async(text)=>trusted('Input.insertText',{text});
      const undo=async()=>trusted('Input.dispatchKeyEvent',{type:'keyDown',key:'z',code:'KeyZ',windowsVirtualKeyCode:90,modifiers:2});
      const setText=async(text)=>{
        drafts.edit(snapshot.address,c=>({...c,text,pastes:[]}));await wait();
        field().focus();field().setSelectionRange(0,0);
      };
      const spacing=[];
      const measureSpacing=label=>{
        const editor=field(),style=getComputedStyle(editor);
        const rect=editor.getBoundingClientRect(),toolbar=document.querySelector('.composer-toolbar');
        const lineBottom=rect.top+parseFloat(style.paddingTop)+parseFloat(style.lineHeight);
        const measurement={label,editor:rect.height,lineHeight:parseFloat(style.lineHeight),
          inputPadding:style.paddingBlock,toolbarPadding:getComputedStyle(toolbar).paddingTop,
          pickerGap:document.querySelector('.picker-trigger').getBoundingClientRect().top-lineBottom,
          sendGap:document.querySelector('.send-button').getBoundingClientRect().top-lineBottom,
          composer:document.querySelector('.composer').getBoundingClientRect().height};
        spacing.push(measurement);
        window.__fixtureMetrics={spacing};
        const outer=getComputedStyle(document.querySelector('.composer'));
        check(measurement.editor>=measurement.lineHeight+3.5 && measurement.editor<=measurement.lineHeight+6,'one-line editor fits its text without a fixed empty 32px block: '+JSON.stringify(measurement));
        check(measurement.sendGap>=3.5 && measurement.sendGap<=6 && measurement.pickerGap>=6.5 && measurement.pickerGap<=9,'compact, nonzero space above toolbar controls: '+JSON.stringify(measurement));
        check(outer.paddingTop==='8px' && outer.paddingBottom==='8px','retain modest, symmetric outer padding');
        check(editor.scrollHeight<=editor.clientHeight+1,'single-line text must not be clipped');
        return measurement;
      };
      await render(<Composer snapshot={snapshot}/>);
      measureSpacing('ready');
      field().focus();
      await insert('hello');await press('Enter');await insert('world');
      check(field().value==='hello\\nworld','normal input and configured newline');
      await undo();check(field().value==='hello\\n','undo typing after newline');
      await press('z',{ctrlKey:true});check(field().value==='hello','undo configured newline');
      await press('z',{ctrlKey:true});check(field().value==='','undo first typing group');
      await press('z',{ctrlKey:true,shiftKey:true});check(field().value==='hello','Ctrl+Shift+Z redo');
      await press('y',{ctrlKey:true});check(field().value==='hello\\n','Ctrl+Y redo');
      await press('y',{ctrlKey:true});check(field().value==='hello\\nworld','redo typing');
      field().setSelectionRange(0,field().value.length);
      // A real replacement is one undoable edit, and restores the selected range.
      await insert('replacement');await press('z',{ctrlKey:true});
      check(field().value==='hello\\nworld','undo selected-text replacement');
      check(field().selectionStart===0 && field().selectionEnd===11,'undo restores the selection');

      await setText('unsent draft');const editor=field();
      await press('ArrowUp');check(field().value==='second prompt','up recalls latest user prompt');
      await press('ArrowUp');check(field().value==='first prompt','up recalls older prompt');
      await press('ArrowDown');check(field().value==='second prompt','down recalls newer prompt');
      await press('ArrowDown');check(field().value==='unsent draft' && field().selectionStart===0,'down restores unsent draft and caret');
      check(field()===editor,'history must retain the textarea DOM');
      await setText('second prompt');field().setSelectionRange(0,0);
      await press('ArrowUp');await press('ArrowDown');
      field().setSelectionRange(field().value.length,field().value.length);
      await insert(' edited');
      check(field().value==='second prompt edited' && field().selectionStart===20,'same-text recall must not leave a stale caret restore');
      await setText('line one\\nline two');field().setSelectionRange(5,5);
      check(!(await press('ArrowUp')).defaultPrevented,'inside multiline input, arrows move the caret');
      field().setSelectionRange(0,4);
      check(!(await press('ArrowUp')).defaultPrevented,'selection is not replaced by recall');
      field().setSelectionRange(0,0);
      check(!(await press('ArrowUp',{shiftKey:true})).defaultPrevented,'Shift+Up selects text');
      await press('ArrowUp',{isComposing:true});check(field().value==='line one\\nline two','IME arrow does not recall');
      field().dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));
      await press('ArrowUp');await press('z',{ctrlKey:true});
      check(field().value==='line one\\nline two','composition blocks recall and undo even without key flag');
      field().dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));await wait();

      await setText('');await insert('/he');
      await until(()=>document.querySelectorAll('.slash-options [role=option]').length>0,'slash completion options');
      const command=field().value;await press('ArrowUp');
      check(field().value===command,'slash completion takes precedence over recall');
      await press('Escape');

      await setText('');await insert('see @s');
      await until(()=>document.querySelector('.slash-options [role=option][aria-selected=true]'),'mention options');
      await press('Enter');
      check(field().value==='see @src/','a folder mention stays open for its children');
      await until(()=>document.querySelector('.slash-options [role=option][aria-selected=true]')?.textContent.includes('src/app.ts'),'folder children');
      await press('Tab');
      check(field().value==='see @src/app.ts ' && !document.querySelector('.slash-options'),'a file mention closes with a space');
      await setText('');await insert('@my');
      await until(()=>document.querySelector('.slash-options [role=option][aria-selected=true]'),'mention options');
      await press('Enter');
      check(field().value==='@"my dir/','paths with spaces are quoted');
      await setText('');await insert('@');
      await until(()=>document.querySelectorAll('.slash-options [role=option]').length===2 && document.querySelector('.slash-options [aria-selected=true]'),'all top-level paths');
      await press('ArrowDown');
      check(document.querySelector('.slash-options [aria-selected=true]')?.textContent.includes('my dir'),'arrows move through mention options');
      await press('Escape');
      await setText('a@b');field().setSelectionRange(3,3);await wait();
      check(!document.querySelector('.slash-options'),'an @ inside a word is not a mention');

      await setText('draft');field().setSelectionRange(5,5);
      const pasted=Array.from({length:12},(_,i)=>'line '+i).join('\\n');
      const clipboard=new DataTransfer();clipboard.setData('text/plain',pasted);
      field().dispatchEvent(new ClipboardEvent('paste',{clipboardData:clipboard,bubbles:true,cancelable:true}));await wait();
      check(field().value.includes('[paste #'),'large paste is folded');
      await press('z',{ctrlKey:true});check(field().value==='draft' && !drafts.read(snapshot.address).content.pastes.length,'undo folded paste');
      await press('y',{ctrlKey:true});check(field().value.includes('[paste #') && drafts.read(snapshot.address).content.pastes[0].text===pasted,'redo retains folded payload');
      const draft=field().value;
      const other={...snapshot,address:{...snapshot.address,sessionId:'other'},info:{...snapshot.info,id:'other'}};
      await render(<Composer snapshot={other}/>);field().focus();await insert('other pane');
      await press('z',{ctrlKey:true});check(field().value==='','undo isolated to the other pane');
      await render(<Composer snapshot={snapshot}/>);
      check(field().value===draft,'switching panes preserves first draft');
      await press('z',{ctrlKey:true});check(field().value==='draft','undo survives switching panes');
      drafts.edit(snapshot.address,emptyContent);await wait();
      await press('z',{ctrlKey:true});check(field().value==='','a send clear does not undo back into an accepted prompt');

      await render(<div/>);
      await render(<Composer snapshot={snapshot}/>);field().focus();await insert('retained edit');
      await render(<div/>);await render(<Composer snapshot={snapshot}/>);
      await press('z',{ctrlKey:true});check(field().value==='','undo survives unmount and remount of the same draft');

      flushSync(()=>useStore.setState({openingTarget:{cwd:'fixture',id:snapshot.info.id},snapshots:{editor:snapshot}}));
      await render(<OpeningComposer preview={snapshot}/>);field().focus();
      await press('ArrowUp');check(field().value==='second prompt','opening an existing chat shares message recall');
      await press('ArrowDown');check(field().value==='','opening an existing chat restores the draft');
      flushSync(()=>useStore.setState({openingTarget:{cwd:'fixture',draftId:'new-editor'},newChatDrafts:{}}));
      await render(<OpeningComposer/>);field().focus();await insert('new draft');await press('Enter');
      await press('z',{ctrlKey:true});check(field().value==='new draft','new-chat editor shares undo');
      await press('z',{ctrlKey:true});check(field().value==='','new-chat typing can be undone');
      await press('y',{ctrlKey:true});check(field().value==='new draft','new-chat editor shares redo');
      measureSpacing('new-chat');
      check(!document.querySelector('.composer-dock kbd'),'no shortcut hints below the editor');

      await render(<Composer snapshot={snapshot}/>);
      await setText('gyp 日本語');
      for(const width of [300,552]) for(const scale of [1,1.25,1.5]){
        document.querySelector('.composer').style.width=width+'px';
        document.documentElement.style.setProperty('--font-scale',String(scale));
        await wait();sizeEditor(field());await wait();
        measureSpacing(width+'px / '+scale);
      }
      await setText('gyp 日本語\\nsecond line\\nlast line');
      check(field().scrollHeight<=field().clientHeight+1,'multiline text grows without clipping at larger font size');
      await setText(Array.from({length:40},()=> 'long input').join('\\n'));
      check(field().getBoundingClientRect().height===220 && field().scrollHeight>field().clientHeight,'long input keeps bounded internal scrolling');
      document.documentElement.style.removeProperty('--font-scale');
      document.querySelector('.composer').style.width='';
      await setText('画像を添付した入力');
      const canvas=document.createElement('canvas');canvas.width=160;canvas.height=90;
      const ctx=canvas.getContext('2d');ctx.fillStyle='#a8c9c4';ctx.fillRect(0,0,160,90);
      const image={id:'image',image:{type:'image',mimeType:'image/png',data:canvas.toDataURL('image/png').split(',')[1]}};
      const checkAttachmentSpacing=label=>{
        const form=document.querySelector('.composer').getBoundingClientRect();
        const thumbnail=document.querySelector('.composer-attachment').getBoundingClientRect();
        const send=document.querySelector('.send-button').getBoundingClientRect();
        check(thumbnail.width===72 && thumbnail.height===72,'do not shrink attachment targets');
        check(Math.abs(thumbnail.top-form.top-13)<=1,'attachment top inset is 8px outer + 1px border + 4px row padding');
        check(Math.abs(form.bottom-send.bottom-9)<=1,'leave 8px outer padding below the controls');
        measureSpacing(label);
      };
      drafts.edit(snapshot.address,c=>({...c,images:[image]}));await wait();
      checkAttachmentSpacing('ready / image');
      flushSync(()=>useStore.setState({newChatImages:{'new-editor':[image]}}));
      await render(<OpeningComposer/>);await wait();
      checkAttachmentSpacing('new-chat / image');
      `,
    ),
  90_000,
);

test.skipIf(!existsSync(fixtureEdge) && !process.env.PIG_REQUIRE_UI_TESTS)(
  "composer unmount saves its view without forcing layout, and remount restores it",
  () =>
    runUiFixture(
      "composer-editor-unmount",
      `
      const {createRoot}=await import(${fixtureImport(import.meta.resolve("react-dom/client"))});
      const {flushSync}=await import(${fixtureImport(import.meta.resolve("react-dom"))});
      const {useState}=await import(${fixtureImport(import.meta.resolve("react"))});
      const {ComposerEditor}=await import(${local("./ComposerEditor.tsx")});
      await import(${local("./styles.css")});
      ${fixtureHelpers}
      const root=createFixtureRoot(createRoot);
      const text=Array.from({length:40},(_,i)=>'line '+i).join('\\n');
      function Editor(){const [value,setValue]=useState(text);
        return <ComposerEditor viewKey="unmount" value={value} onChange={e=>setValue(e.target.value)} onRestore={e=>setValue(e.text)}/>;}
      flushSync(()=>root.render(<div className="composer"><Editor/></div>));await wait();
      let input=document.querySelector('textarea');
      check(input.scrollHeight>input.clientHeight,'fixture text must overflow the editor');
      input.focus();input.setSelectionRange(12,20);
      input.scrollTop=60;await wait();
      const top=input.scrollTop;
      check(top>0,'editor must scroll');
      const descriptor=Object.getOwnPropertyDescriptor(Element.prototype,'scrollTop');
      let reads=0;
      Object.defineProperty(Element.prototype,'scrollTop',{configurable:true,get(){if(this instanceof HTMLTextAreaElement)reads++;return descriptor.get.call(this);},set(v){descriptor.set.call(this,v);}});
      // Dirty the layout first, as removing a large pane does.
      document.body.appendChild(document.createElement('div')).style.height='10px';
      flushSync(()=>root.render(null));
      Object.defineProperty(Element.prototype,'scrollTop',descriptor);
      check(reads===0,'unmount must not read the editor scroll position (forces layout): '+reads);
      flushSync(()=>root.render(<div className="composer"><Editor/></div>));await wait();
      input=document.querySelector('textarea');
      check(Math.abs(input.scrollTop-top)<=1,'remount must restore the scroll position: '+input.scrollTop+' vs '+top);
      check(input.selectionStart===12&&input.selectionEnd===20,'remount must restore the selection');
      root.unmount();
      `,
    ),
  60_000,
);
