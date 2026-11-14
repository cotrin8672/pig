import { test } from "bun:test";
import { existsSync } from "node:fs";
import {
  fixtureEdge,
  fixtureHelpers,
  fixtureImport,
  runUiFixture,
} from "../../scripts/ui-fixture";

test.skipIf(!existsSync(fixtureEdge) && !process.env.PIG_REQUIRE_UI_TESTS)(
  "automatic history in Edge: prefetch, native input, stable anchors, retries and stale replies",
  () =>
    runUiFixture(
      "history-paging",
      `
    const {createRoot}=await import(${fixtureImport(import.meta.resolve("react-dom/client"))});
    const {flushSync}=await import(${fixtureImport(import.meta.resolve("react-dom"))});
    const {Chat}=await import(${fixtureImport(new URL("./App.tsx", import.meta.url))});
    const {useStore}=await import(${fixtureImport(new URL("./store.ts", import.meta.url))});
    const {addressKey}=await import(${fixtureImport(new URL("./chat-snapshot.ts", import.meta.url))});
    await import(${fixtureImport(new URL("./styles.css", import.meta.url))});
    ${fixtureHelpers}
    const root=createFixtureRoot(createRoot),calls=[];
    const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
    const first=deferred(),second=deferred(),stale=deferred(),oldEpoch=deferred();
    const user=i=>({id:'r'+i,entryId:'r'+i,parentId:null,branchId:'branch',order:i,kind:'message',
      message:{role:'user',content:'Question '+i+'\\n'+'Full preserved line 日本語\\n'.repeat(5),timestamp:i}});
    const assistant=(id,order,text)=>({id,entryId:id,parentId:null,branchId:'branch',order,kind:'message',message:{role:'assistant',
      content:[{type:'text',text}],api:'openai-responses',provider:'fixture',model:'model',timestamp:order,stopReason:'stop',
      usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}}});
    const page=(start,revision='branch',before)=>({history:{revision,before},records:Array.from({length:50},(_,i)=>user(start+i)),tools:{},current:null,running:false,liveToEntry:{}});
    const snapshot=(revision='branch',epoch=1)=>({address:{hostId:'paging',sessionId:'chat',epoch},snapshotSeq:1,
      info:{id:'chat',cwd:'fixture',title:'Paging',modified:1},effort:'off',effortLevels:[],
      transcript:{...page(100,revision,'r100'),records:Array.from({length:100},(_,i)=>user(100+i))}});
    window.__requests={listSlashCommands:async()=>[],syncDraft:async params=>({applied:true,draft:{...params.content,revision:params.expectedRevision+1}}),getSessionHistory:request=>{
      calls.push(request);
      if(request.revision==='stale')return stale.promise;
      if(request.epoch===2)return oldEpoch.promise;
      if(request.revision==='broken')return Promise.resolve(page(50,'broken',calls.length===6?'r100':undefined));
      if(calls.length===1)return first.promise;
      if(calls.length===2)return Promise.reject(Error('Temporary history failure'));
      if(calls.length===3)return second.promise;
      throw Error('Unexpected duplicate request '+JSON.stringify(request));
    }};
    const publish=next=>flushSync(()=>useStore.setState(s=>({snapshots:{...s.snapshots,chat:next}})));
    flushSync(()=>useStore.setState(s=>({snapshots:{chat:snapshot()},notices:[],settings:{...s.settings,language:'en'}})));
    function StoredChat(){const value=useStore(s=>s.snapshots.chat);return <Chat key={addressKey(value.address)} snapshot={value}/>;}
    flushSync(()=>root.render(<div style={{height:600}}><StoredChat/></div>));
    await until(()=>document.querySelector('textarea'),'editor must mount');await wait();
    let thread=document.querySelector('.thread-scroll');
    check(thread.scrollTop>thread.clientHeight*2&&calls.length===0,'opening the recent tail must not eagerly load the entire conversation');
    check(![...document.querySelectorAll('button')].some(button=>button.textContent.includes('Load earlier')),'there must be no manual history-load button');
    const input=async(method,params)=>{window.__fixtureInput={method,params};await until(()=>!window.__fixtureInput,'trusted input must be delivered');};
    let wheel;
    thread.addEventListener('wheel',event=>{wheel=event;},{passive:true});
    const rect=thread.getBoundingClientRect();
    await input('Input.dispatchMouseEvent',{type:'mouseWheel',x:rect.left+12,y:rect.top+Math.min(rect.height,innerHeight-rect.top)/2,
      deltaX:0,deltaY:Math.round(thread.clientHeight/2-thread.scrollTop)});
    await until(()=>calls.length===1,'approaching the top must prefetch without reaching the edge');await wait();
    check(wheel?.isTrusted&&!wheel.defaultPrevented&&thread.scrollTop>0,'prefetch must use native scrolling and start before reaching the hard top');
    const requestTop=thread.scrollTop;
    await input('Input.dispatchMouseEvent',{type:'mouseWheel',x:rect.left+12,y:rect.top+120,deltaX:0,deltaY:70});await wait();
    check(thread.scrollTop>requestTop+10&&calls.length===1,'a pending page must neither block native scrolling nor duplicate the request');
    const editor=document.querySelector('textarea');editor.focus();let typed;
    editor.addEventListener('input',event=>{typed=event;},{once:true});
    const inputStart=performance.now();
    await input('Input.insertText',{text:'Draft while loading 日本語'});await wait();
    check(typed?.isTrusted&&editor.value==='Draft while loading 日本語'&&calls.length===1,'input must be processed while history I/O is pending');
    const inputMs=performance.now()-inputStart;
    const visibleReader=()=>[...thread.querySelectorAll('[data-record-id]')].find(row=>row.getBoundingClientRect().top>=thread.getBoundingClientRect().top+24);
    const reader=visibleReader(),readerTop=reader.getBoundingClientRect().top;
    const text=reader.querySelector('.user-bubble'),selection=getSelection(),range=document.createRange();range.selectNodeContents(text);selection.removeAllRanges();selection.addRange(range);
    const selected=selection.toString();
    let frame=0,last=performance.now(),maxFrameGap=0,frames=0;
    const tick=now=>{maxFrameGap=Math.max(maxFrameGap,now-last);last=now;frames++;frame=requestAnimationFrame(tick);};frame=requestAnimationFrame(tick);
    const applyStart=performance.now();first.resolve(page(50,'branch','r50'));
    await until(()=>thread.querySelectorAll('[data-record-id]').length===150,'the prefetched page must appear automatically');await wait();
    const pageApplyMs=performance.now()-applyStart;
    check(reader.isConnected&&Math.abs(reader.getBoundingClientRect().top-readerTop)<=2,'prepend must preserve the current reader, not the position when the request started');
    check(selection.toString()===selected&&document.querySelector('textarea')===editor&&editor.value==='Draft while loading 日本語','prepend must retain selection, editor DOM and draft');
    await pause(100);check(calls.length===1,'one prefetched page must not drain all remaining history while the reader stays away from the top');selection.removeAllRanges();
    thread.focus();let keyEvent;thread.addEventListener('keydown',event=>{keyEvent=event;},{once:true});
    await input('Input.dispatchKeyEvent',{type:'keyDown',key:'Home',code:'Home',windowsVirtualKeyCode:36,nativeVirtualKeyCode:36});
    await input('Input.dispatchKeyEvent',{type:'keyUp',key:'Home',code:'Home',windowsVirtualKeyCode:36,nativeVirtualKeyCode:36});
    check(keyEvent?.isTrusted&&!keyEvent.defaultPrevented,'keyboard readers must be able to reach and load earlier history');
    try { await until(()=>calls.length===2&&useStore.getState().notices.length===1,'history errors must use the existing notification UI'); }
    catch(error){throw Error(String(error)+' '+JSON.stringify({calls,notices:useStore.getState().notices,top:thread.scrollTop,history:useStore.getState().snapshots.chat.transcript.history}));}
    for(let i=0;i<4;i++){thread.dispatchEvent(new Event('scroll'));await wait();}
    check(calls.length===2&&!document.querySelector('.transcript [role="alert"]'),'a failure must not spin or insert an error row that shifts the conversation');
    window.dispatchEvent(new Event('focus'));await until(()=>calls.length===3,'focus recovery must retry a failed page without a load button');
    const oldFirst=thread.querySelector('[data-record-id="r50"]'),oldTop=oldFirst.getBoundingClientRect().top;
    const earlier=page(0);earlier.records[49]=assistant('math',49,'$$x^2 + y^2 = z^2$$\\n\\n'.repeat(8));
    second.resolve(earlier);
    await until(()=>thread.querySelectorAll('[data-record-id]').length===200,'the final older page must be retained');
    await until(()=>thread.querySelector('[data-record-id="math"] .katex'),'older Markdown must finish formatting');await wait();
    check(oldFirst.isConnected&&Math.abs(oldFirst.getBoundingClientRect().top-oldTop)<=2,'late Markdown layout above the reader must not move the reading position');
    check(thread.querySelector('[data-record-id="r0"]')&&thread.querySelector('[data-record-id="r199"]'),'all loaded history must remain mounted and accessible');
    const scrollProperty=Object.getOwnPropertyDescriptor(Element.prototype,'scrollTop');let scrollWrites=0;
    Object.defineProperty(thread,'scrollTop',{configurable:true,get(){return scrollProperty.get.call(this);},set(value){scrollWrites++;scrollProperty.set.call(this,value);}});
    const nativeTop=thread.scrollTop;
    await input('Input.dispatchMouseEvent',{type:'mouseWheel',x:rect.left+12,y:rect.top+120,deltaX:0,deltaY:-140});await wait();
    check(Math.abs(thread.scrollTop-(nativeTop-140))<=2&&scrollWrites===0,'post-prepend wheel scrolling must remain native without viewport corrections');
    const afterWheel=oldFirst.getBoundingClientRect().top,firstRow=thread.querySelector('[data-record-id="r0"]');firstRow.style.minHeight=(firstRow.getBoundingClientRect().height+90)+'px';await wait();
    check(scrollWrites===0&&Math.abs(oldFirst.getBoundingClientRect().top-afterWheel)<=2,'after user scrolling, late growth must use browser anchoring rather than pull the reader back');
    thread.scrollTop=0;thread.dispatchEvent(new Event('scroll'));await wait();check(calls.length===3,'history exhaustion must stop prefetching');
    cancelAnimationFrame(frame);
    const staleSnapshot=snapshot('stale');publish(staleSnapshot);await wait();thread=document.querySelector('.thread-scroll');thread.scrollTop=0;thread.dispatchEvent(new Event('scroll'));
    await until(()=>calls.length===4,'stale-revision fixture must start its request');
    const replacement=snapshot('replacement');replacement.transcript={...page(0,'replacement'),records:[user(999)]};publish(replacement);await wait();stale.resolve(page(50,'stale'));await wait();
    check(thread.querySelectorAll('[data-record-id]').length===1&&thread.querySelector('[data-record-id="r999"]'),'an old branch reply must not resurrect history');
    publish(snapshot('epoch',2));await wait();thread=document.querySelector('.thread-scroll');thread.scrollTop=0;thread.dispatchEvent(new Event('scroll'));
    await until(()=>calls.length===5,'old epoch fixture must start its request');
    const newOwner=snapshot('new-owner',3);newOwner.transcript={...page(0,'new-owner'),records:[user(777)]};publish(newOwner);await wait();oldEpoch.resolve(page(50,'epoch'));await wait();
    check(document.querySelectorAll('[data-record-id]').length===1&&document.querySelector('[data-record-id="r777"]'),'unmounted old owners must not apply replies');
    publish(snapshot('broken',3));await wait();thread=document.querySelector('.thread-scroll');thread.scrollTop=0;thread.dispatchEvent(new Event('scroll'));
    await until(()=>calls.length===6&&useStore.getState().notices.length===2,'a nonadvancing cursor must report one failure');await pause(150);
    check(calls.length===6&&thread.querySelectorAll('[data-record-id]').length===100,'a nonadvancing cursor must not duplicate rows or enter an automatic loop');
    await pause(550);
    await input('Input.dispatchMouseEvent',{type:'mouseWheel',x:rect.left+12,y:rect.top+120,deltaX:0,deltaY:-100});
    await until(()=>calls.length===7&&thread.querySelectorAll('[data-record-id]').length===150,'scrolling upward again at the hard top must retry without a button or leaving the prefetch area');
    window.__fixtureMetrics={initialRows:100,finalLoadedRows:200,requests:calls.length,inputWhilePendingMs:inputMs,pageApplyMs,maxFrameGapMs:maxFrameGap,frames,
      note:'Synthetic Edge fixture; input includes runner polling, not physical key latency; frame gaps are observations, not a real-session guarantee'};
    root.unmount();
  `,
    ),
  60_000,
);
