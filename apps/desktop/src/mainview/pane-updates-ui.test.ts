import { test } from "bun:test";
import { existsSync } from "node:fs";
import {
  fixtureEdge,
  fixtureHelpers,
  fixtureImport,
  runUiFixture,
} from "../../scripts/ui-fixture";

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
      await import(${fixtureImport(new URL("./styles.css", import.meta.url))});
      ${fixtureHelpers}
      const root=createFixtureRoot(createRoot),reads={a:0,b:0};
      window.__requests={listSlashCommands:async()=>[]};
      function snapshot(id,seq=1,epoch=1){
        const transcript={history:{revision:id},records:Array.from({length:100},(_,i)=>({
          id:id+'-'+i,entryId:id+'-'+i,parentId:i?id+'-'+(i-1):null,branchId:id,order:i,kind:'message',
          message:{role:'user',content:'Question '+id+' '+i+' '+(i===99?'update '+seq:'words '.repeat(20)),timestamp:i},
        })),tools:{},current:null,running:false,liveToEntry:{}};
        const records=transcript.records;
        Object.defineProperty(transcript,'records',{enumerable:true,get(){reads[id]++;return records;}});
        return {address:{hostId:'panes',sessionId:id,epoch},snapshotSeq:seq,
          info:{id,cwd:'fixture',title:'Chat '+id,modified:1},effort:'off',effortLevels:[],transcript};
      }
      const a=snapshot('a'),b=snapshot('b');
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
      reads.a=reads.b=0;
      for(let seq=2;seq<=7;seq++){
        publish('a',seq);await wait();
        check(pane(1).textContent.includes('update '+seq),'active pane must show its latest snapshot');
      }
      check(reads.a>0&&reads.b===0,'active updates must not render/read another chat transcript: '+JSON.stringify(reads));
      check(editorA===pane(1).querySelector('textarea')&&editorA.value==='draft a 未確定'&&document.activeElement===editorA,'active publications must retain IME editor DOM, text and focus');
      check(editorA.selectionStart===caret[0]&&editorA.selectionEnd===caret[1],'active publications must preserve the composing caret');
      reads.a=reads.b=0;
      publish('b',2);await wait();
      check(pane(2).textContent.includes('update 2')&&reads.b>0&&reads.a===0,'unfocused panes must keep updating without rendering the active transcript: '+JSON.stringify(reads));
      check(threadA.scrollTop===topA&&threadB.scrollTop===topB,'publications must retain independent reader positions');
      editorA.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'確定'}));
      setText(editorA,'draft a 確定');await wait();
      editorB.focus();setText(editorB,'draft b');await wait();
      check(useStore.getState().activePane===2,'focus must select the pane');
      check(pane(1).querySelector('textarea')===editorA&&editorA.value==='draft a 確定'&&pane(2).querySelector('textarea')===editorB,'focus changes must not remount either editor');
      reads.a=reads.b=0;
      publish('b',3);await wait();
      check(pane(2).textContent.includes('update 3')&&reads.a===0&&reads.b>0,'the new active pane must also isolate its updates: '+JSON.stringify(reads));
      const divider=document.querySelector('.pane-preview-divider');
      divider.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true,cancelable:true}));await wait();
      check(pane(1).querySelector('textarea')===editorA&&pane(2).querySelector('textarea')===editorB&&editorB.value==='draft b'&&document.activeElement===editorB,'resizing must retain drafts, editors and focus');
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
      `,
    ),
  60_000,
);
