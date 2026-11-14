import { test } from "bun:test";
import { existsSync } from "node:fs";
import {
  fixtureEdge,
  fixtureHelpers,
  fixtureImport,
  runUiFixture,
} from "../../scripts/ui-fixture";

test.skipIf(!existsSync(fixtureEdge) && !process.env.PIG_REQUIRE_UI_TESTS)(
  "pane winbars stay transparent and truncate long names at narrow widths and larger text sizes",
  () =>
    runUiFixture(
      "pane-winbars",
      `
    const {createRoot}=await import(${fixtureImport(import.meta.resolve("react-dom/client"))});
    const {flushSync}=await import(${fixtureImport(import.meta.resolve("react-dom"))});
    const {PaneWorkspace}=await import(${fixtureImport(new URL("./PaneWorkspace.tsx", import.meta.url))});
    const {useStore}=await import(${fixtureImport(new URL("./store.ts", import.meta.url))});
    await import(${fixtureImport(new URL("./styles.css", import.meta.url))});
    ${fixtureHelpers}
    const root=createFixtureRoot(createRoot),host=document.getElementById('root');
    host.style.cssText='width:640px;height:360px;background:repeating-linear-gradient(90deg,rgb(30,50,70) 0 4px,rgb(100,120,140) 4px 8px)';
    const snapshot=id=>({address:{hostId:'bars',sessionId:id,epoch:1},snapshotSeq:1,
      info:{id,cwd:'long-project-name-'.repeat(20),title:'Long session title '.repeat(30),modified:1},
      effort:'off',effortLevels:[],transcript:{records:[],tools:{},current:null,running:false,liveToEntry:{}}});
    flushSync(()=>useStore.setState(s=>({
      activePane:1,panes:{1:{sessionId:'a'},2:{sessionId:'b'}},snapshots:{a:snapshot('a'),b:snapshot('b')},
      paneTree:{type:'split',axis:'columns',weights:[0.5,0.5],children:[{type:'pane',id:1},{type:'pane',id:2}]},
      settings:{...s.settings,language:'en'},
    })));
    flushSync(()=>root.render(<PaneWorkspace renderChat={()=>null}>{null}</PaneWorkspace>));await wait();
    const bars=[...document.querySelectorAll('.pane-winbar')];
    for(const width of [640,320])for(const scale of [1,1.5]){
      host.style.width=width+'px';document.documentElement.style.setProperty('--font-scale',String(scale));await wait();
      for(const bar of bars){
        const rect=bar.getBoundingClientRect(),content=bar.parentElement.querySelector('.pane-content').getBoundingClientRect();
        check(rect.height===18*scale+8&&content.top===rect.bottom,'one scaled text line must stay above the conversation');
        for(const node of bar.querySelectorAll('.pane-winbar-project,.pane-winbar-title')){
          const bounds=node.getBoundingClientRect(),style=getComputedStyle(node);
          check(bounds.width>0&&bounds.left>=rect.left&&bounds.right<=rect.right,'both labels must remain inside narrow panes');
          check(node.scrollWidth>node.clientWidth&&style.textOverflow==='ellipsis'&&node.title===node.textContent,'long names must truncate while retaining their full tooltip');
        }
        check(bar.scrollWidth===bar.clientWidth,'long labels must not overflow the winbar');
      }
    }
    host.style.width='640px';document.documentElement.style.setProperty('--font-scale','1');await wait();
    const pixel=await capturePixels();
    for(const bar of bars){
      const rect=bar.getBoundingClientRect(),x=rect.left+rect.width-8,y=rect.top+2;
      check(JSON.stringify(pixel(x,y))===JSON.stringify(pixel(x,rect.bottom+4)),'the striped shared background must remain unchanged through the winbar');
    }
    // Keep the bars mounted for the fixture's final screenshot.
  `,
    ),
  60_000,
);

test.skipIf(!existsSync(fixtureEdge) && !process.env.PIG_REQUIRE_UI_TESTS)(
  "pane updates in Edge: isolated subscriptions, live background panes and retained editors",
  () =>
    runUiFixture(
      "pane-updates",
      `
      const {createRoot}=await import(${fixtureImport(import.meta.resolve("react-dom/client"))});
      const {flushSync}=await import(${fixtureImport(import.meta.resolve("react-dom"))});
      const {App}=await import(${fixtureImport(new URL("./App.tsx", import.meta.url))});
      const {useStore}=await import(${fixtureImport(new URL("./store.ts", import.meta.url))});
      const {navigationRevision}=await import(${fixtureImport(new URL("./navigation.ts", import.meta.url))});
      const {getT}=await import(${fixtureImport(new URL("./i18n.ts", import.meta.url))});
      const {interruptedSession}=await import(${fixtureImport(new URL("./session-status.ts", import.meta.url))});
      const {splitPane}=await import(${fixtureImport(new URL("./pane-layout.ts", import.meta.url))});
      await import(${fixtureImport(new URL("./styles.css", import.meta.url))});
      ${fixtureHelpers}
      const root=createFixtureRoot(createRoot),reads={a:0,b:0};
      let requestIdReads=0;
      window.__requests={listSlashCommands:async()=>[]};
      function snapshot(id,seq=1,epoch=1){
        const transcript={history:{revision:id},records:Array.from({length:100},(_,i)=>{
          const content='Question '+id+' '+i+' '+(i===99?'update '+seq:'words '.repeat(20));
          return {id:id+'-'+i,entryId:id+'-'+i,parentId:i?id+'-'+(i-1):null,branchId:id,order:i,kind:'message',
            get requestId(){requestIdReads++;return undefined;},
            message:{role:'user',get content(){reads[id]++;return content;},timestamp:i}};
        }),tools:{},current:null,running:false,liveToEntry:{}};
        return {address:{hostId:'panes',sessionId:id,epoch},snapshotSeq:seq,
          info:{id,cwd:'fixture',title:'Chat '+id,modified:1},effort:'off',effortLevels:[],transcript};
      }
      const a=snapshot('a'),b=snapshot('b');
      // Status selection may read the latest role/stopReason without rendering
      // any body. Measure body access itself, not access to the records array.
      interruptedSession(a);interruptedSession(b);
      check(reads.a===0&&reads.b===0,'metadata-only status selection must not count as body rendering');
      void a.transcript.records[0].message.content;
      check(reads.a===1,'the body-rendering probe must detect an actual body read');
      reads.a=reads.b=0;
      flushSync(()=>useStore.setState(s=>({
        initialized:true,page:'chat',active:'a',activePane:1,
        paneTree:{type:'split',axis:'columns',weights:[0.5,0.5],children:[{type:'pane',id:1},{type:'pane',id:2}]},
        panes:{1:{sessionId:'a'},2:{sessionId:'b'}},snapshots:{a,b},addresses:{a:a.address,b:b.address},sessions:{},
        bootstrap:{...s.bootstrap,generalCwd:'fixture'},settings:{...s.settings,language:'en'},
      })));
      flushSync(()=>root.render(<App/>));
      const pane=id=>document.querySelector('[data-pane-id="'+id+'"]');
      await until(()=>pane(1)?.querySelector('textarea')&&pane(2)?.querySelector('textarea'),'both real chat editors must mount');
      await wait();
      const winbar=id=>pane(id).querySelector('.pane-winbar');
      check(winbar(1).textContent.includes('Chat a')&&winbar(2).textContent.includes('Chat b'),'each pane must show its own session title');
      for(const id of [1,2]){
        const bar=winbar(id),style=getComputedStyle(bar),rect=bar.getBoundingClientRect();
        check(style.backgroundColor==='rgba(0, 0, 0, 0)'&&style.opacity==='1'&&style.borderTopWidth==='0px','winbars must have a completely transparent background and no border, without fading their text');
        check(rect.height===26&&rect.top===pane(id).getBoundingClientRect().top,'winbars must occupy one compact line at the top of each pane');
        check(pane(id).querySelector('.pane-content').getBoundingClientRect().top===rect.bottom,'winbars must not overlap the conversation');
      }
      // This label is read only by App: count shell renders without production hooks.
      const translations=getT(),toggleLabel=translations['Toggle sidebar'];
      let shellReads=0;
      Object.defineProperty(translations,'Toggle sidebar',{configurable:true,get(){shellReads++;return toggleLabel;}});
      const editorA=pane(1).querySelector('textarea'),editorB=pane(2).querySelector('textarea');
      const threadA=pane(1).querySelector('.thread-scroll'),threadB=pane(2).querySelector('.thread-scroll');
      threadA.scrollTop=160;threadA.dispatchEvent(new Event('scroll'));threadB.scrollTop=260;threadB.dispatchEvent(new Event('scroll'));
      const topA=threadA.scrollTop,topB=threadB.scrollTop;
      check(topA>0&&topB>topA,'histories must scroll independently');
      reads.a=reads.b=0;
      flushSync(()=>useStore.setState({openMessage:'Unrelated startup progress'}));await wait();
      check(reads.a===0&&reads.b===0,'unrelated startup progress must not render ready chat transcripts: '+JSON.stringify(reads));
      const setText=(editor,text,isComposing=false)=>{
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(editor,text);
        editor.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:text,isComposing}));
      };
      editorA.focus();setText(editorA,'draft a');await wait();
      editorA.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));
      setText(editorA,'draft a 未確定',true);editorA.setSelectionRange(8,11);await wait();
      const caret=[editorA.selectionStart,editorA.selectionEnd];
      const publish=(id,seq,epoch=1)=>flushSync(()=>useStore.setState(s=>({snapshots:{...s.snapshots,[id]:snapshot(id,seq,epoch)}})));
      reads.a=reads.b=shellReads=requestIdReads=0;
      for(let seq=2;seq<=7;seq++){
        publish('a',seq);await wait();
        check(pane(1).textContent.includes('update '+seq),'active pane must show its latest snapshot');
      }
      check(reads.a>0&&reads.b===0,'active updates must not render/read another chat transcript: '+JSON.stringify(reads));
      check(shellReads===0,'six active snapshot updates must not render the app shell: '+shellReads+' label reads');
      check(requestIdReads===0,'Chat, Composer and optimistic bubbles must not scan request IDs when no sends are pending: '+requestIdReads);
      check(editorA===pane(1).querySelector('textarea')&&editorA.value==='draft a 未確定'&&document.activeElement===editorA,'active publications must retain IME editor DOM, text and focus');
      check(editorA.selectionStart===caret[0]&&editorA.selectionEnd===caret[1],'active publications must preserve the composing caret');
      reads.a=reads.b=0;
      publish('b',2);await wait();
      check(shellReads===0,'background snapshot updates must not render the app shell');
      check(pane(2).textContent.includes('update 2')&&reads.b>0&&reads.a===0,'unfocused panes must keep updating without rendering the active transcript: '+JSON.stringify(reads));
      check(threadA.scrollTop===topA&&threadB.scrollTop===topB,'publications must retain independent reader positions');
      const beforeTitle=winbar(2).getBoundingClientRect();
      flushSync(()=>useStore.setState(s=>({snapshots:{...s.snapshots,b:{...s.snapshots.b,info:{...s.snapshots.b.info,title:'Background renamed'}}}})));await wait();
      check(winbar(2).querySelector('.pane-winbar-title').textContent==='Background renamed'&&winbar(1).textContent.includes('Chat a'),'background metadata must update only its own winbar');
      check(winbar(2).getBoundingClientRect().height===beforeTitle.height&&threadA.scrollTop===topA&&threadB.scrollTop===topB,'title updates must not move the conversation');
      // Restore metadata so subsequent publish() calls measure token-only updates.
      publish('b',2);await wait();
      editorA.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'確定'}));
      setText(editorA,'draft a 確定');await wait();
      editorB.focus();setText(editorB,'draft b');await wait();
      check(useStore.getState().activePane===2,'focus must select the pane');
      check(pane(1).querySelector('textarea')===editorA&&editorA.value==='draft a 確定'&&pane(2).querySelector('textarea')===editorB,'focus changes must not remount either editor');
      reads.a=reads.b=shellReads=0;
      publish('b',3);await wait();
      check(pane(2).textContent.includes('update 3')&&reads.a===0&&reads.b>0,'the new active pane must also isolate its updates: '+JSON.stringify(reads));
      check(shellReads===0,'the newly active pane must not render the app shell for token updates');
      flushSync(()=>useStore.setState(s=>({snapshots:{...s.snapshots,b:{...s.snapshots.b,info:{...s.snapshots.b.info,title:'Renamed active chat',cwd:'changed-project',modified:2}}}})));await wait();
      check(document.querySelector('.chat-heading small')?.textContent==='Renamed active chat'&&document.querySelector('.chat-heading span')?.textContent==='changed-project','title and project metadata must still update the window header');
      check(winbar(2).querySelector('.pane-winbar-project').textContent==='changed-project'&&winbar(2).querySelector('.pane-winbar-title').textContent==='Renamed active chat','the active winbar must also follow title and project changes');
      check(shellReads>0&&pane(2).querySelector('textarea')===editorB&&editorB.value==='draft b'&&document.activeElement===editorB,'metadata changes must update the shell without remounting or blurring the editor');
      const divider=document.querySelector('.pane-preview-divider');
      divider.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true,cancelable:true}));await wait();
      check(pane(1).querySelector('textarea')===editorA&&pane(2).querySelector('textarea')===editorB&&editorB.value==='draft b'&&document.activeElement===editorB,'resizing must retain drafts, editors and focus');
      flushSync(()=>useStore.setState(s=>({paneTree:splitPane(s.paneTree,2,3,'rows'),panes:{...s.panes,3:{}}})));await wait();
      check(pane(3)&&pane(1).querySelector('textarea')===editorA&&pane(2).querySelector('textarea')===editorB&&editorB.value==='draft b'&&document.activeElement===editorB,'splitting must retain existing chat and editor DOM, drafts and focus');
      publish('a',8,2);await wait();
      check(pane(1).textContent.includes('update 8')&&pane(1).querySelector('textarea')!==editorA,'an epoch replacement must render the new owner, not stale memoized content');
      check(pane(2).querySelector('textarea')===editorB&&editorB.value==='draft b','replacing another chat must not remount the active editor');
      flushSync(()=>useStore.setState(s=>({
        opening:true,openingViewRevision:navigationRevision,openingTarget:{cwd:'fixture',id:'b'},
        openingAddress:s.snapshots.b.address,openMessage:'Preparing this runtime',
        snapshots:{...s.snapshots,b:{...s.snapshots.b,ready:false}},
      })));await wait();
      check(pane(2).textContent.includes('Preparing this runtime'),'the owning startup preview must still show progress');
      reads.a=reads.b=0;
      flushSync(()=>useStore.setState({openMessage:'Loading these extensions'}));await wait();
      check(pane(2).textContent.includes('Loading these extensions')&&reads.b>0&&reads.a===0,'startup progress must update only its owning preview: '+JSON.stringify(reads));
      root.unmount();
      Object.defineProperty(translations,'Toggle sidebar',{configurable:true,writable:true,value:toggleLabel});
      `,
    ),
  60_000,
);

test.skipIf(!existsSync(fixtureEdge) && !process.env.PIG_REQUIRE_UI_TESTS)(
  "new panes render immediately and only the first submit starts an SDK session",
  () =>
    runUiFixture(
      "lazy-chat-panes",
      `
    const {createRoot}=await import(${fixtureImport(import.meta.resolve("react-dom/client"))});
    const {flushSync}=await import(${fixtureImport(import.meta.resolve("react-dom"))});
    const {useStore}=await import(${fixtureImport(new URL("./store.ts", import.meta.url))});
    const {openChat,startOpeningChat}=await import(${fixtureImport(new URL("./rpc.ts", import.meta.url))});
    const {createPane,focusPane}=await import(${fixtureImport(new URL("./pane-state.ts", import.meta.url))});
    const {PaneWorkspace}=await import(${fixtureImport(new URL("./PaneWorkspace.tsx", import.meta.url))});
    const {WindowTitlebar}=await import(${fixtureImport(new URL("./WindowTitlebar.tsx", import.meta.url))});
    const {Composer}=await import(${fixtureImport(new URL("./Composer.tsx", import.meta.url))});
    const {drafts}=await import(${fixtureImport(new URL("./draft-store.ts", import.meta.url))});
    const {ChatLayout}=await import(${fixtureImport(new URL("./ChatLayout.tsx", import.meta.url))});
    const {openingDraftKey,queueOpeningSelection}=await import(${fixtureImport(new URL("./opening-sends.ts", import.meta.url))});
    const {selectStartingChats}=await import(${fixtureImport(new URL("./ui-selectors.ts", import.meta.url))});
    await import(${fixtureImport(new URL("./styles.css", import.meta.url))});
    ${fixtureHelpers}
    const calls=[],prompts=[],selections=[];
    const model={provider:'test',id:'default',name:'Default model'};
    const alternate={provider:'test',id:'alternate',name:'Alternate model'};
    window.__requests={
      runtimeState:async()=>({hostId:'lazy',sessions:[],pendingUI:[],drafts:[],statuses:[]}),
      heartbeatUI:async()=>({connected:true}),
      openSession:params=>new Promise((resolve,reject)=>calls.push({params,resolve,reject})),
      getOpenState:async()=>({state:'failed',message:'Fixture startup failure'}),
      listSessions:async()=>[],listSlashCommands:async()=>[],
      getRecovery:async()=>({hostId:'lazy',sendIntents:[],retainedDrafts:[]}),
      setModel:async params=>{selections.push(params.id);return {model:params.id==='alternate'?alternate:model,effort:'off',effortLevels:[]};},
      syncDraft:async params=>({applied:true,draft:{...params.content,revision:params.expectedRevision+1}}),
      prompt:async params=>{prompts.push(params);return {disposition:'started'};},
    };
    flushSync(()=>useStore.setState(s=>({initialized:true,page:'chat',active:undefined,
      activePane:1,paneTree:{type:'pane',id:1},panes:{1:{}},pendingOpens:{},snapshots:{},
      bootstrap:{...s.bootstrap,generalCwd:'fixture',models:[model,alternate]},
      settings:{...s.settings,language:'en'},
    })));
    const renderChat=snapshot=><ChatLayout composer={<Composer snapshot={snapshot}/>}/>;
    function Workspace(){const active=useStore(s=>s.active&&s.snapshots[s.active]);return <PaneWorkspace renderChat={renderChat}>{active?renderChat(active):null}</PaneWorkspace>;}
    const root=createFixtureRoot(createRoot);
    flushSync(()=>root.render(<><Workspace/><WindowTitlebar maximized={false} onAction={()=>{}} onSplit={createPane}/></>));
    const pane=id=>document.querySelector('[data-pane-id="'+id+'"]');
    const closeButton=id=>pane(id).querySelector('.pane-close');
    flushSync(()=>{void openChat('fixture');});
    check(pane(1).querySelector('textarea')&&pane(1).textContent.includes('What shall we build?'),'new chat must render synchronously');
    const firstId=useStore.getState().panes[1].openId;
    const firstKey=openingDraftKey(useStore.getState().pendingOpens[firstId]);
    const editorA=pane(1).querySelector('textarea');
    const bar=document.querySelector('.window-titlebar');
    const barBounds=bar.getBoundingClientRect();
    window.dispatchEvent(new MouseEvent('mousemove',{clientX:barBounds.left+10,clientY:2}));
    await until(()=>bar.getBoundingClientRect().height===34,'Zen bar must reveal its split buttons');
    const [columns,rows]=bar.querySelectorAll('.window-pane-controls button');
    check(bar.querySelectorAll('button').length===5&&!bar.textContent.includes('Close pane'),'Zen bar must contain no pane-close control');
    check(!closeButton(1),'a single pane must not render a close control');
    const minimize=bar.querySelector('.window-controls:not(.window-pane-controls) button');
    const columnsRect=columns.getBoundingClientRect(),rowsRect=rows.getBoundingClientRect(),minimizeRect=minimize.getBoundingClientRect();
    check(columnsRect.right<rowsRect.left&&minimizeRect.left-rowsRect.right===12,'split buttons must sit left of minimize with a separate 12px gap');
    for(const button of [columns,rows,minimize]){
      const rect=button.getBoundingClientRect(),icon=button.querySelector('svg').getBoundingClientRect();
      check(rect.top===minimizeRect.top&&rect.height===minimizeRect.height,'split controls must align vertically with window controls');
      check(Math.abs((icon.left+icon.right)-(rect.left+rect.right))<1&&Math.abs((icon.top+icon.bottom)-(rect.top+rect.bottom))<1,'each control icon must be centered');
    }
    flushSync(()=>rows.click());
    const secondId=useStore.getState().panes[2].openId;
    const secondKey=openingDraftKey(useStore.getState().pendingOpens[secondId]);
    check(firstId!==secondId&&firstKey!==secondKey,'same-project panes need independent draft identities');
    const editorB=pane(2).querySelector('textarea');
    check(editorB&&pane(1).querySelector('textarea')===editorA,'split must synchronously render the default page and retain the old editor');
    check(!document.querySelector('[aria-busy="true"]')&&!document.body.textContent.includes('Opening chat'),'local drafts must not claim to be loading');
    check(calls.length===0&&Object.keys(useStore.getState().snapshots).length===0&&selectStartingChats(useStore.getState(),'fixture','New chat').length===0,'opening and splitting must create no SDK calls or sidebar chats');
    const setText=(editor,text)=>{
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(editor,text);
      editor.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:text}));
    };
    editorA.focus();setText(editorA,'draft one');await wait();
    editorA.setSelectionRange(2,5);
    editorB.focus();setText(editorB,'draft two');await wait();
    flushSync(()=>queueOpeningSelection(secondId,{model:alternate,effort:'off',effortLevels:[]}));
    check(pane(2).textContent.includes('Alternate model')&&!pane(1).textContent.includes('Alternate model'),'model choice must belong to its pane');
    flushSync(()=>focusPane(1));flushSync(()=>focusPane(2));
    check(pane(1).querySelector('textarea')===editorA&&pane(2).querySelector('textarea')===editorB&&editorA.value==='draft one'&&editorB.value==='draft two','local editors and drafts survive focus changes');
    flushSync(()=>columns.click());
    const third=useStore.getState().activePane;
    check(pane(third).querySelector('textarea')&&calls.length===0,'repeated splits must not wait for SDK startup');
    check(useStore.getState().paneTree.axis==='rows'&&useStore.getState().paneTree.children[1].axis==='columns','Zen buttons must split the focused pane along their own axes');
    for(const id of [1,2,third]){
      const button=closeButton(id),rect=button.getBoundingClientRect(),bounds=pane(id).getBoundingClientRect();
      check(!button.disabled&&Math.abs(bounds.right-rect.right-12)<1&&Math.abs(rect.top-bounds.top-36)<1,'each pane must retain its own top-right close control, separate from the text-only winbar');
      check(pane(id).querySelector('.pane-winbar-title').textContent==='New chat','unsent panes must also show a winbar');
      check(document.elementFromPoint((rect.left+rect.right)/2,(rect.top+rect.bottom)/2)?.closest('.pane-close')===button,'Zen bar must not cover pane-close controls');
    }
    flushSync(()=>focusPane(2));editorB.focus();await wait();
    let stoleFocus=false;const stopTracking=useStore.subscribe(s=>{if(s.activePane!==2)stoleFocus=true;});
    flushSync(()=>{
      const button=closeButton(third);
      button.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));
      button.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true}));
      button.click();
    });
    stopTracking();
    check(!pane(third)&&pane(1).querySelector('textarea')===editorA&&pane(2).querySelector('textarea')===editorB,'each close button must remove its own pane, not the active pane');
    check(!stoleFocus&&document.activeElement===editorB,'closing an inactive pane must not steal editor focus even temporarily');
    check(calls.length===0,'closing an unsent pane must not start a session');
    pane(2).querySelector('form').requestSubmit();
    await until(()=>calls.length===1,'first submit must start one SDK open');
    startOpeningChat(secondId);
    check(calls.length===1,'duplicate startup must be ignored');
    setText(editorB,'newer typing');await wait();
    calls[0].reject(Error('startup failed'));
    await until(()=>useStore.getState().panes[2].openId!==secondId,'startup failure must restore the local editor');
    check(editorB===pane(2).querySelector('textarea')&&editorB.value==='draft two\\n\\nnewer typing','failure must preserve editor DOM and restore the unsent message before newer text');
    pane(2).querySelector('form').requestSubmit();
    await until(()=>calls.length===2,'explicit retry must start a fresh SDK open');
    check(calls[1].params.openId!==calls[0].params.openId,'retry must use a new SDK mutation identity');
    setText(editorB,'keep after send');await wait();
    editorA.focus();await wait();
    const snapshot={address:{hostId:'lazy',sessionId:'created',epoch:1},snapshotSeq:1,
      info:{id:'created',cwd:'fixture',title:'Created chat',modified:1},model:alternate,effort:'off',effortLevels:[],
      transcript:{history:{revision:'created'},records:[],tools:{},current:null,running:false,liveToEntry:{}},
    };
    calls[1].resolve(snapshot);
    await until(()=>prompts.length===1&&pane(2).querySelector('textarea')?.value==='keep after send','the first message and newer typing must transfer to the background session');
    check(prompts[0].text==='draft two\\n\\nnewer typing'&&selections.at(-1)==='alternate','captured message must follow its selected model');
    check(useStore.getState().activePane===1&&useStore.getState().active===undefined,'background startup must not steal focus: '+JSON.stringify({activePane:useStore.getState().activePane,active:useStore.getState().active,openId:useStore.getState().openId,firstId}));
    check(pane(1).querySelector('textarea')===editorA&&editorA.value==='draft one','another pane startup must not change the unsent editor');
    check(useStore.getState().panes[2].sessionId==='created','only the submitted pane is promoted to a real chat');
    flushSync(()=>useStore.setState(s=>({snapshots:{...s.snapshots,created:{...s.snapshots.created,transcript:{...s.snapshots.created.transcript,running:true}}}})));
    const retained=useStore.getState().snapshots.created;
    flushSync(()=>focusPane(2));flushSync(()=>closeButton(2).click());
    check(!pane(2)&&useStore.getState().activePane===1&&!closeButton(1),'closing a session pane must focus the remaining pane and remove its final close button');
    check(useStore.getState().snapshots.created===retained&&retained.transcript.running&&drafts.read(snapshot.address).content.text==='keep after send','closing a pane must retain its running session and draft');
    check(pane(1).querySelector('textarea')===editorA&&editorA.value==='draft one','closing another pane must preserve the remaining draft DOM');
    check(!useStore.getState().notices.some(notice=>notice.message.includes('Unmocked RPC')),'all production RPC paths must be covered');
    await wait();
  `,
      { realRpc: true },
    ),
  60_000,
);
