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
  "multiple panes reflow during drag without publishing sizes or losing the reader",
  () =>
    runUiFixture(
      "resize-panes",
      `
    const {createRoot}=await import(${fixtureImport(import.meta.resolve("react-dom/client"))});
    const {flushSync}=await import(${fixtureImport(import.meta.resolve("react-dom"))});
    const {App}=await import(${local("./App.tsx")});
    const {splitPane}=await import(${local("./pane-layout.ts")});
    const {useStore}=await import(${local("./store.ts")});
    await import(${local("./styles.css")});
    ${fixtureHelpers}
    const root=createFixtureRoot(createRoot),prefs=[],historyRequests=[];
    const first=useStore.getState(),cwd='fixture',hostId='resize';
    const earlier=Promise.withResolvers();
    window.__requests={
      bootstrap:async()=>({...first.bootstrap,generalCwd:cwd}),
      appearance:async()=>first.appearance,settings:async()=>({...first.settings,language:'en'}),
      actionKeymaps:async()=>[],listSessions:async()=>[],listInstalled:async()=>[],
      remoteHosts:async()=>[],providerUsage:async()=>[],listSlashCommands:async()=>[],
      getRecovery:async()=>({hostId}),runtimeState:async()=>({hostId,publicationSeq:0,sessions:[],pendingUI:[],drafts:[],statuses:[]}),
      syncDraft:async q=>({applied:true,draft:{...q.content,revision:q.expectedRevision+1}}),
      setUiPreferences:async p=>{prefs.push(p);},
      getSessionHistory:q=>{historyRequests.push(q);return earlier.promise;},
    };
    const records=(id,start,count)=>Array.from({length:count},(_,i)=>({
      id:id+(start+i),entryId:id+(start+i),parentId:null,branchId:id,order:start+i,kind:'message',
      message:{role:'user',content:'Question '+(start+i)+' '+'Width changes where this line wraps. '.repeat(13),timestamp:start+i},
    }));
    const snapshot=(id,records,before)=>({address:{hostId,sessionId:id,epoch:1},snapshotSeq:1,
      info:{id,cwd,title:'Chat '+id,modified:1},effort:'off',effortLevels:[],
      transcript:{history:{revision:id,before},records,tools:{},current:null,running:false,liveToEntry:{}}});
    const a=snapshot('a',records('a',40,40),'a40'),b=snapshot('b',records('b',0,84));
    flushSync(()=>{useStore.setState({page:'settings'});root.render(<App/>);});
    await until(()=>useStore.getState().initialized&&useStore.getState().hostId===hostId,'host is ready');
    flushSync(()=>useStore.setState(s=>({
      page:'chat',active:'a',activePane:1,
      paneTree:{type:'split',axis:'columns',weights:[0.5,0.5],children:[{type:'pane',id:1},{type:'pane',id:2}]},
      panes:{1:{sessionId:'a'},2:{sessionId:'b'}},snapshots:{a,b},addresses:{a:a.address,b:b.address},
      bootstrap:{...s.bootstrap,desktop:{sessions:{},chatWidth:768,sidebarWidth:260}},
    })));
    const panes=[...document.querySelectorAll('.pane-view')];
    const threads=panes.map(p=>p.querySelector('.thread-scroll'));
    const editors=panes.map(p=>p.querySelector('.composer textarea'));
    const width=node=>node.getBoundingClientRect().width;
    const transcriptWidths=()=>threads.map(t=>width(t.querySelector('.transcript')));
    const bottom=t=>t.scrollHeight-t.scrollTop-t.clientHeight<=1;
    await document.fonts.ready;
    await until(()=>bottom(threads[0])&&bottom(threads[1]),'both panes start at their own tail');
    check(!threads[0].querySelector('[data-virtual-turns]')&&threads[1].querySelector('[data-virtual-turns]'),'only the long chat starts virtualized');
    threads[0].scrollTop=680;
    await until(()=>historyRequests.length===1,'approaching older history must still prefetch');
    const row=[...threads[0].querySelectorAll('[data-record-id]')].find(r=>r.getBoundingClientRect().top>=threads[0].getBoundingClientRect().top+24);
    const readerY=row.getBoundingClientRect().top;
    const range=document.createRange();range.selectNodeContents(row.querySelector('.user-bubble'));
    const selection=getSelection();selection.removeAllRanges();selection.addRange(range);
    const selected=selection.toString();await wait();
    earlier.resolve(snapshot('a',records('a',0,40)).transcript);
    await until(()=>threads[0].querySelector('[data-virtual-turns]')&&useStore.getState().snapshots.a.transcript.records.length===80,'the older page crosses the inline limit');
    await new Promise(r=>setTimeout(r,400));await wait();
    check(row.isConnected&&Math.abs(row.getBoundingClientRect().top-readerY)<=2,'prepending across the limit must keep the same reader at the same position: '+[row.dataset.recordId,row.isConnected,readerY,row.getBoundingClientRect().top,threads[0].scrollTop]);
    check(selection.toString()===selected&&selected.length>0,'the switch to virtual rows must retain the DOM selection');
    check(threads.every(t=>t.querySelectorAll('[data-record-id]').length<40),'history data remains while offscreen rows unmount');
    selection.removeAllRanges();
    const input=async(method,params)=>{window.__fixtureInput={method,params};await until(()=>!window.__fixtureInput,'trusted input '+method);await wait();};
    editors[0].focus();await input('Input.insertText',{text:'keep this draft'});
    const mouse=(type,x,y)=>input('Input.dispatchMouseEvent',{type,x,y,button:'left',buttons:type==='mouseReleased'?0:1,clickCount:1});
    const centre=el=>{const r=el.getBoundingClientRect();return [r.left+r.width/2,r.top+r.height*.4];};
    const pause=ms=>new Promise(r=>setTimeout(r,ms));
    let widthWrites=0,treeWrites=0;
    const stop=useStore.subscribe((s,p)=>{
      if(s.bootstrap.desktop.chatWidth!==p.bootstrap.desktop.chatWidth)widthWrites++;
      if(s.paneTree!==p.paneTree)treeWrites++;
    });
    const guide=width(panes[0].querySelector('.chat-width-guides'));
    const [x,y]=centre(panes[0].querySelector('.chat-width-handle.right'));
    await mouse('mousePressed',x,y);await mouse('mouseMoved',x-32,y);
    await until(()=>transcriptWidths().every(w=>Math.abs(w-guide+64)<=1),'both chat widths follow the handle');
    await pause(160);
    check(widthWrites===0&&prefs.length===0,'dragging must not publish or save shared chat width');
    check(getComputedStyle(row.querySelector('.user-bubble')).getPropertyValue('--chat-width').trim()==='','chat width must not inherit into conversation text');
    const c=snapshot('c',records('c',0,1));
    flushSync(()=>useStore.setState(s=>({
      paneTree:splitPane(s.paneTree,2,3,'rows'),panes:{...s.panes,3:{sessionId:'c'}},
      snapshots:{...s.snapshots,c},addresses:{...s.addresses,c:c.address},
    })));
    const lateShell=document.querySelector('[data-pane-id="3"] .chat-shell');
    const lateWidth=()=>width(lateShell.querySelector('.transcript'));
    check(Math.abs(lateWidth()-guide+64)<=1,'a pane mounted mid-drag must join the preview without any further pointer movement');
    await mouse('mouseReleased',x-36,y);
    await until(()=>prefs.length===1,'release saves chat width');
    check(widthWrites===1&&transcriptWidths().every(w=>Math.abs(w-guide+72)<=1),'release commits the final coordinates once');
    check(!lateShell.style.getPropertyValue('--chat-width')&&Math.abs(lateWidth()-guide+72)<=1,'the new pane must clear its preview and use the committed width');
    const divider=document.querySelector('.pane-preview-divider');
    const [dx,dy]=centre(divider),before=width(panes[0]);
    const saved=localStorage.getItem('pig.pane-workspace'),writesBefore=treeWrites;
    await mouse('mousePressed',dx,dy);await mouse('mouseMoved',dx+40,dy);
    await until(()=>Math.abs(width(panes[0])-before-40)<=1,'pane division follows the pointer');
    check(treeWrites===writesBefore&&localStorage.getItem('pig.pane-workspace')===saved,'live split geometry must not reach persistent state');
    await mouse('mouseReleased',dx+40,dy);
    check(treeWrites===writesBefore+1&&localStorage.getItem('pig.pane-workspace')!==saved,'release saves the split once');
    const [sx,sy]=centre(document.querySelector('.sidebar-resizer'));
    await mouse('mousePressed',sx,sy);await mouse('mouseMoved',sx+60,sy);
    await until(()=>Math.abs(width(document.querySelector('.sidebar'))-320)<=1,'sidebar follows the pointer');
    check(useStore.getState().bootstrap.desktop.sidebarWidth===260,'sidebar drag must not publish the preference');
    await mouse('mouseReleased',sx+60,sy);
    await until(()=>prefs.length===2&&bottom(threads[1]),'release saves sidebar width and the other chat keeps following its tail');
    check(editors.every((e,i)=>panes[i].querySelector('textarea')===e)&&editors[0].value==='keep this draft','all drags must preserve the editor DOM and draft');
    check(row.isConnected&&row.getBoundingClientRect().bottom>threads[0].getBoundingClientRect().top,'resizing must not discard the current reader');
    stop();
    useStore.setState({jump:{sessionId:'a',entryId:'a1',nonce:1}});
    await until(()=>threads[0].querySelector('[data-record-id="a1"].search-target'),'a search hit outside the virtual window must still be revealed');
    root.unmount();
  `,
      {
        realRpc: true,
        virtualTurns: true,
        viewport: { width: 1600, height: 880 },
      },
    ),
  60_000,
);
